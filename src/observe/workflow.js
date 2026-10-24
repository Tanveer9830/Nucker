import { MessageFlags } from 'discord.js';
import { calculateObservationMetrics } from '../metrics/calculator.js';
import { CancellationError } from '../orchestrator/cancellation.js';
import { SCENARIO_CATALOG } from '../scenarios/catalog/index.js';
import {
  ASSESSMENT_STATES,
  CREATOR_ATTRIBUTION,
  OBSERVATION_STAGES,
  OVERALL_OBSERVATION_STATUSES,
  TARGET_IDENTIFICATION_STATES
} from '../utils/constants.js';
import { generateId } from '../utils/ids.js';

export function renderStageProgressMessage(observationId, stages, extraNote = '') {
  const badge = (status) => {
    if (status === 'COMPLETED') return '[DONE]';
    if (status === 'IN_PROGRESS') return '[RUNNING]';
    if (status === 'FAILED') return '[FAILED]';
    if (status === 'CANCELLED') return '[CANCELLED]';
    return '[PENDING]';
  };

  const lines = [
    `**TANVEER KA BETA NEWKER — AUTONOMOUS OBSERVATION**`,
    `Observation ID: \`${observationId}\``,
    ''
  ];

  for (const s of stages) {
    lines.push(`${s.index}. ${badge(s.status)} ${s.label}`);
  }

  if (extraNote) {
    lines.push('', extraNote);
  }
  lines.push('', `_${CREATOR_ATTRIBUTION}_`);
  return lines.join('\n');
}

export class ObservationWorkflow {
  constructor({
    config,
    db,
    repositories,
    taskManager,
    environmentDiscovery,
    planner,
    scenarioEngine,
    securityAnalyzer,
    safetyGate,
    reportGenerator,
    operatorNotifier,
    evidenceStore,
    logger = null,
    faultInjector = null
  }) {
    this.config = config;
    this.db = db;
    this.repositories = repositories;
    this.taskManager = taskManager;
    this.environmentDiscovery = environmentDiscovery;
    this.planner = planner;
    this.scenarioEngine = scenarioEngine;
    this.securityAnalyzer = securityAnalyzer;
    this.safetyGate = safetyGate;
    this.reportGenerator = reportGenerator;
    this.operatorNotifier = operatorNotifier;
    this.evidenceStore = evidenceStore;
    this.logger = logger;
    this.faultInjector = faultInjector;
  }

  /**
   * Executes the zero-argument /observe autonomous security observation workflow (Part 4).
   */
  async run({ interaction = null, guildOverride = null, scenariosOverride = null } = {}) {
    const observationId = generateId('obs');
    const startedAt = new Date().toISOString();

    const stages = OBSERVATION_STAGES.map((s) => ({
      index: s.index,
      key: s.key,
      label: s.label,
      status: 'PENDING',
      startedAt: null,
      completedAt: null
    }));

    let currentStageObj = stages[0];
    let lastSuccessfulStage = null;

    const updateProgressUi = async (extraNote = '') => {
      if (!interaction) return;
      const content = renderStageProgressMessage(observationId, stages, extraNote);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content });
        } else if (typeof interaction.reply === 'function') {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
      } catch (uiErr) {
        this.logger?.debug('Progress UI update skipped', { error: uiErr.message });
      }
    };

    const beginStage = async (stageIndex) => {
      const stage = stages[stageIndex - 1];
      currentStageObj = stage;
      stage.status = 'IN_PROGRESS';
      stage.startedAt = new Date().toISOString();
      this.repositories.updateObservationRun(observationId, {
        currentStageIndex: stageIndex,
        stages
      });
      await updateProgressUi();
      if (typeof this.faultInjector === 'function') {
        await this.faultInjector(stage.key, observationId);
      }
    };

    const completeStage = async (stageIndex, patch = {}) => {
      const stage = stages[stageIndex - 1];
      stage.status = 'COMPLETED';
      stage.completedAt = new Date().toISOString();
      lastSuccessfulStage = stage.key;
      this.repositories.updateObservationRun(observationId, {
        ...patch,
        lastSuccessfulStage,
        stages
      });
      await updateProgressUi();
    };

    // Immediate acknowledgment & observation record creation
    this.repositories.createObservationRun({
      observationId,
      operatorId: this.config.authorizedOperatorId,
      guildId: guildOverride?.id || interaction?.guildId || null,
      guildName: guildOverride?.name || interaction?.guild?.name || null,
      stages,
      startedAt
    });

    const { cancellationToken } = this.taskManager.registerRun(observationId, {
      guildId: guildOverride?.id || interaction?.guildId || null
    });

    try {
      // Stage 1: Initializing security assessment
      await beginStage(1);
      cancellationToken.throwIfCancelled();
      this.repositories.syncScenarioDefinitions(scenariosOverride || SCENARIO_CATALOG);
      await completeStage(1, { overallStatus: OVERALL_OBSERVATION_STATUSES.RUNNING });

      // Stage 2: Verifying authorization and environment
      await beginStage(2);
      cancellationToken.throwIfCancelled();
      if (!this.config.privilegedEnabled || !this.config.validation.valid) {
        const cfgErr = new Error('Platform safety/operator configuration is invalid.');
        cfgErr.category = 'CONFIGURATION_ERROR';
        throw cfgErr;
      }
      await completeStage(2);

      // Stage 3: Inspecting available Discord metadata
      await beginStage(3);
      cancellationToken.throwIfCancelled();
      const discordMetadata = await this.environmentDiscovery.inspectDiscordMetadata({
        observationId,
        interaction,
        guildOverride
      });
      await completeStage(3, {
        guildId: discordMetadata.guildId,
        guildName: discordMetadata.guildName
      });

      // Stage 4: Identifying configured target integrations
      await beginStage(4);
      cancellationToken.throwIfCancelled();
      const integrationInspection = await this.environmentDiscovery.inspectIntegrationsAndHealth({
        observationId,
        discordMetadata
      });
      const targetDiscovery = integrationInspection.targetDiscovery;
      const integrationStatus = this.deriveIntegrationStatusLabel(
        targetDiscovery,
        integrationInspection.telemetry
      );
      await completeStage(4, {
        targetBotName: targetDiscovery.botName,
        targetBotId: targetDiscovery.verified ? targetDiscovery.botId : null,
        targetIdentificationState: targetDiscovery.state,
        integrationStatus
      });

      // Stage 5: Checking permissions and collector health
      await beginStage(5);
      cancellationToken.throwIfCancelled();
      const limitations = this.collectCriticalLimitations({
        discordMetadata,
        targetDiscovery,
        telemetry: integrationInspection.telemetry,
        collectorHealth: integrationInspection.collectorHealth
      });
      const fullEnvironment = {
        ...discordMetadata,
        targetDiscovery,
        telemetry: integrationInspection.telemetry,
        collectorHealth: integrationInspection.collectorHealth,
        databaseHealth: integrationInspection.databaseHealth,
        observationConfig: integrationInspection.observationConfig
      };
      await completeStage(5, {
        environment: fullEnvironment,
        limitations
      });

      // Stage 6: Preparing test scenarios
      await beginStage(6);
      cancellationToken.throwIfCancelled();
      const plan = this.planner.createPlan({
        scenarios: scenariosOverride || SCENARIO_CATALOG,
        environment: fullEnvironment,
        telemetrySnapshot: integrationInspection.telemetry
      });
      await completeStage(6, {
        plan: plan.summary
      });

      // Stage 7: Running controlled simulations
      await beginStage(7);
      cancellationToken.throwIfCancelled();
      const suiteExecution = await this.scenarioEngine.executeSuite({
        observationId,
        selectedItems: plan.selected,
        blockedItems: plan.blocked,
        targetTelemetryEvents: integrationInspection.rawTelemetryEvents,
        liveDiscordEvents: [],
        telemetryAvailable: integrationInspection.telemetry.available
      });

      if (suiteExecution.cancelled || cancellationToken.isCancelled) {
        throw new CancellationError(
          cancellationToken.reason || 'Observation cancelled during simulation stage.'
        );
      }
      await completeStage(7);

      // Stage 8: Correlating evidence
      await beginStage(8);
      cancellationToken.throwIfCancelled();
      const persistedExecutions =
        this.repositories.listScenarioExecutionsByObservation(observationId);
      await completeStage(8);

      // Stage 9: Calculating metrics & running security analysis
      await beginStage(9);
      cancellationToken.throwIfCancelled();
      const activeBaseline = this.repositories.getActiveBaseline(discordMetadata.guildId);
      const metrics = calculateObservationMetrics({
        executions: suiteExecution.executions,
        plannedCount: plan.selected.length,
        activeBaseline
      });

      const analysis = this.securityAnalyzer.analyzeObservation({
        observationId,
        executions: suiteExecution.executions,
        environment: fullEnvironment,
        metrics,
        activeBaseline
      });

      const approvalSummary = this.safetyGate.evaluateEligibility({
        operatorId: this.config.authorizedOperatorId,
        guildId: discordMetadata.guildId,
        targetDiscovery,
        selectedScenarios: plan.selected.map((s) => s.scenario)
      });

      const overallStatus = this.deriveOverallCompletionStatus({
        targetDiscovery,
        telemetry: integrationInspection.telemetry,
        approvalSummary
      });

      await completeStage(9, {
        metrics,
        approvalSummary,
        assessmentState: approvalSummary.assessmentState,
        overallStatus
      });

      // Stage 10: Preparing and delivering the private report
      await beginStage(10);
      cancellationToken.throwIfCancelled();
      const completedAt = new Date().toISOString();
      this.repositories.updateObservationRun(observationId, {
        completedAt,
        overallStatus
      });

      const { structuredReport, renderedMarkdown } =
        this.reportGenerator.generateFromDatabase(observationId);

      const delivery = await this.operatorNotifier.deliverPrivateReport({
        observationId,
        reportType: 'OBSERVATION_REPORT',
        structuredReport,
        renderedMarkdown,
        interaction
      });

      stages[9].status = 'COMPLETED';
      stages[9].completedAt = completedAt;
      this.repositories.updateObservationRun(observationId, {
        lastSuccessfulStage: stages[9].key,
        stages,
        completedAt
      });

      await updateProgressUi(
        delivery.dmDelivered
          ? `Observation complete. Private report delivered via Discord DM (\`${observationId}\`).`
          : `Observation complete. Report saved securely (\`${observationId}\`); use \`/observe-report\` to view.`
      );

      return {
        observationId,
        overallStatus,
        assessmentState: approvalSummary.assessmentState,
        integrationStatus,
        metrics,
        findingsCount: analysis.findings.length,
        executionsCount: persistedExecutions.length,
        dmDelivered: delivery.dmDelivered,
        fallbackUsed: delivery.fallbackUsed,
        report: structuredReport,
        renderedMarkdown
      };
    } catch (error) {
      if (error instanceof CancellationError || error?.name === 'CancellationError' || cancellationToken.isCancelled) {
        return await this.handleCancelledRun({
          observationId,
          stages,
          currentStageObj,
          lastSuccessfulStage,
          reason: error.message || cancellationToken.reason || 'Cancelled by /stop',
          interaction,
          updateProgressUi
        });
      }

      return await this.handleFailedRun({
        observationId,
        stages,
        currentStageObj,
        lastSuccessfulStage,
        error,
        interaction,
        updateProgressUi
      });
    } finally {
      this.evidenceStore.clearObservationCache(observationId);
      this.taskManager.unregisterRun(observationId);
    }
  }

  deriveIntegrationStatusLabel(targetDiscovery, telemetry) {
    if (targetDiscovery.verified && telemetry.available) {
      return `VERIFIED_WITH_TELEMETRY (${telemetry.activeSources.join(', ')})`;
    }
    if (targetDiscovery.verified && !telemetry.available) {
      return 'TARGET_ID_VERIFIED_NO_EXTERNAL_TELEMETRY';
    }
    if (targetDiscovery.state === TARGET_IDENTIFICATION_STATES.AMBIGUOUS) {
      return 'AMBIGUOUS_TARGET_BOT_ID_UNSET';
    }
    if (telemetry.available) {
      return `TELEMETRY_LOADED_UNVERIFIED_BOT_ID (${telemetry.activeSources.join(', ')})`;
    }
    return 'STANDALONE_SIMULATION_NO_ASTRA_INTEGRATION';
  }

  deriveOverallCompletionStatus({ targetDiscovery, telemetry, approvalSummary }) {
    // Part 9 & Part 10: Never label a target "FULLY_OBSERVED" if integration or evidence is incomplete!
    if (approvalSummary.assessmentState === ASSESSMENT_STATES.READY_FOR_APPROVAL && telemetry.available) {
      return OVERALL_OBSERVATION_STATUSES.READY_FOR_APPROVAL;
    }
    if (targetDiscovery.verified && telemetry.available) {
      return OVERALL_OBSERVATION_STATUSES.COMPLETED_VERIFIED_TELEMETRY;
    }
    if (targetDiscovery.verified || telemetry.available) {
      return OVERALL_OBSERVATION_STATUSES.COMPLETED_PARTIAL_VISIBILITY;
    }
    return OVERALL_OBSERVATION_STATUSES.COMPLETED_SIMULATION_ONLY;
  }

  collectCriticalLimitations({ discordMetadata, targetDiscovery, telemetry, collectorHealth }) {
    const limitations = [];
    if (!discordMetadata.guildConnected) {
      limitations.push(
        'No live Discord guild context inspected; observation executed in standalone simulation environment.'
      );
    } else if (discordMetadata.missingPermissions.length > 0) {
      limitations.push(
        `Bot is missing recommended observation permission(s): ${discordMetadata.missingPermissions.join(', ')}.`
      );
    }

    if (targetDiscovery.state === TARGET_IDENTIFICATION_STATES.AMBIGUOUS) {
      limitations.push(
        `Ambiguous target identity: ${targetDiscovery.candidateBots.length} bots present in guild without ASTRA_ASTRA_BOT_ID configured.`
      );
    } else if (!targetDiscovery.verified) {
      limitations.push(
        `Astra Astra bot identity is not verified (${targetDiscovery.state}).`
      );
    }

    if (!telemetry.available) {
      limitations.push(
        'No Astra Astra telemetry source (JSON logs, incident reports, detection history, or webhook) was connected; target-facing assertions were marked INCONCLUSIVE rather than fabricated.'
      );
    }

    if (collectorHealth.errors && collectorHealth.errors.length > 0) {
      for (const err of collectorHealth.errors) {
        limitations.push(`Telemetry collector warning: ${err}`);
      }
    }

    return limitations;
  }

  async handleCancelledRun({
    observationId,
    stages,
    currentStageObj,
    lastSuccessfulStage,
    reason,
    interaction,
    updateProgressUi
  }) {
    if (currentStageObj && currentStageObj.status === 'IN_PROGRESS') {
      currentStageObj.status = 'CANCELLED';
      currentStageObj.completedAt = new Date().toISOString();
    }
    const completedAt = new Date().toISOString();
    const persistedExecs = this.repositories.listScenarioExecutionsByObservation(observationId);
    const partialMetrics = calculateObservationMetrics({ executions: persistedExecs });

    this.repositories.updateObservationRun(observationId, {
      overallStatus: OVERALL_OBSERVATION_STATUSES.CANCELLED,
      assessmentState: ASSESSMENT_STATES.NOT_ELIGIBLE,
      lastSuccessfulStage,
      failureCategory: 'OPERATOR_CANCELLED',
      failureMessage: reason,
      metrics: partialMetrics,
      stages,
      completedAt
    });

    const { structuredReport, renderedMarkdown } =
      this.reportGenerator.generateFromDatabase(observationId);

    const delivery = await this.operatorNotifier.deliverPrivateReport({
      observationId,
      reportType: 'CANCELLED_OBSERVATION_REPORT',
      structuredReport,
      renderedMarkdown,
      interaction
    });

    await updateProgressUi(`Observation \`${observationId}\` cancelled cleanly: ${reason}`);

    return {
      observationId,
      overallStatus: OVERALL_OBSERVATION_STATUSES.CANCELLED,
      cancelled: true,
      reason,
      dmDelivered: delivery.dmDelivered,
      fallbackUsed: delivery.fallbackUsed,
      report: structuredReport,
      renderedMarkdown
    };
  }

  async handleFailedRun({
    observationId,
    stages,
    currentStageObj,
    lastSuccessfulStage,
    error,
    interaction,
    updateProgressUi
  }) {
    const failedStageKey = currentStageObj?.key || 'UNKNOWN_STAGE';
    if (currentStageObj) {
      currentStageObj.status = 'FAILED';
      currentStageObj.completedAt = new Date().toISOString();
    }

    const errorCategory = error.category || error.name || 'UNEXPECTED_WORKFLOW_ERROR';
    const completedAt = new Date().toISOString();

    let databaseSaved = false;
    let reportSaved = false;

    try {
      this.repositories.updateObservationRun(observationId, {
        overallStatus: OVERALL_OBSERVATION_STATUSES.FAILED,
        assessmentState: ASSESSMENT_STATES.NOT_ELIGIBLE,
        failedStage: failedStageKey,
        failureCategory: errorCategory,
        failureMessage: error.message,
        lastSuccessfulStage,
        stages,
        completedAt
      });
      databaseSaved = true;
    } catch (dbErr) {
      this.logger?.error('Failed to save failed-run state to SQLite', { error: dbErr.message });
    }

    const recommendedRecoveryAction =
      'Run /health and /config-validate to verify SQLite integrity, environment settings, and Astra Astra telemetry paths, then rerun /observe.';

    const failureMarkdown = this.reportGenerator.renderWorkflowFailureMarkdown({
      observationId,
      failedStage: failedStageKey,
      errorCategory,
      lastSuccessfulStage,
      databaseSaved,
      reportSaved: true,
      recommendedRecoveryAction
    });

    const failureStructured = {
      header: 'TANVEER KA BETA NEWKER — OBSERVATION WORKFLOW FAILURE NOTICE',
      observationId,
      failedStage: failedStageKey,
      errorCategory,
      lastSuccessfulStage,
      databaseSaved,
      reportSaved: true,
      recommendedRecoveryAction
    };

    let delivery = { dmDelivered: false, fallbackUsed: true };
    try {
      delivery = await this.operatorNotifier.deliverPrivateReport({
        observationId,
        reportType: 'WORKFLOW_FAILURE_REPORT',
        structuredReport: failureStructured,
        renderedMarkdown: failureMarkdown,
        interaction
      });
      reportSaved = true;
    } catch (notifyErr) {
      reportSaved = false;
      this.logger?.error('Failed to persist/deliver workflow failure report', {
        error: notifyErr.message
      });
    }

    await updateProgressUi(
      `Observation \`${observationId}\` failed at stage \`${failedStageKey}\` (${errorCategory}). Failure notice saved.`
    );

    return {
      observationId,
      overallStatus: OVERALL_OBSERVATION_STATUSES.FAILED,
      failed: true,
      failedStage: failedStageKey,
      errorCategory,
      lastSuccessfulStage,
      databaseSaved,
      reportSaved,
      dmDelivered: delivery.dmDelivered,
      fallbackUsed: delivery.fallbackUsed,
      renderedMarkdown: failureMarkdown
    };
  }
}
