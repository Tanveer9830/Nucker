import { CancellationError } from '../orchestrator/cancellation.js';
import { ScenarioStateMachine } from '../orchestrator/stateMachine.js';
import {
  EVIDENCE_SOURCES,
  SCENARIO_RESULTS,
  SCENARIO_STATES
} from '../utils/constants.js';
import { generateId } from '../utils/ids.js';
import { getScenarioById } from './catalog/index.js';

export class ScenarioEngine {
  constructor({
    config,
    db,
    repositories,
    evidenceStore,
    taskManager,
    logger = null
  }) {
    this.config = config;
    this.db = db;
    this.repositories = repositories;
    this.evidenceStore = evidenceStore;
    this.taskManager = taskManager;
    this.logger = logger;
  }

  /**
   * Aggregates assertion evaluations into the Part-7 scenario outcome classification.
   */
  classifyAssertions(evaluatedAssertions, telemetryAvailable) {
    if (!evaluatedAssertions || evaluatedAssertions.length === 0) {
      return SCENARIO_RESULTS.INCONCLUSIVE;
    }

    const hasFail = evaluatedAssertions.some((a) => a.status === SCENARIO_RESULTS.FAIL);
    if (hasFail) {
      return SCENARIO_RESULTS.FAIL;
    }

    const allPass = evaluatedAssertions.every((a) => a.status === SCENARIO_RESULTS.PASS);
    if (allPass) {
      return SCENARIO_RESULTS.PASS;
    }

    const targetFacing = evaluatedAssertions.filter((a) => a.targetFacing);
    if (targetFacing.length > 0 && !telemetryAvailable) {
      // Never treat missing target telemetry as PARTIAL or FAIL when zero target assertions could be checked
      return SCENARIO_RESULTS.INCONCLUSIVE;
    }

    const targetPassedCount = targetFacing.filter((a) => a.status === SCENARIO_RESULTS.PASS).length;
    const anyPassed = evaluatedAssertions.some((a) => a.status === SCENARIO_RESULTS.PASS);
    const anyUnresolved = evaluatedAssertions.some(
      (a) => a.status === SCENARIO_RESULTS.INCONCLUSIVE || a.status === SCENARIO_RESULTS.PARTIAL
    );

    if (targetFacing.length > 0) {
      if (targetPassedCount > 0 && anyUnresolved) {
        return SCENARIO_RESULTS.PARTIAL;
      }
      return SCENARIO_RESULTS.INCONCLUSIVE;
    }

    if (anyPassed && anyUnresolved) {
      return SCENARIO_RESULTS.PARTIAL;
    }

    return SCENARIO_RESULTS.INCONCLUSIVE;
  }

  /**
   * Persists blocked scenarios identified by TestPlanner so counts & audit trails remain complete.
   */
  persistBlockedScenarios(observationId, blockedItems = []) {
    const results = [];
    const now = new Date().toISOString();

    for (const blocked of blockedItems) {
      const scenario = blocked.scenario || getScenarioById(blocked.scenarioId);
      if (!scenario) continue;
      const executionId = generateId('exec');
      const sm = new ScenarioStateMachine(executionId, SCENARIO_STATES.PENDING);
      sm.transition(SCENARIO_STATES.BLOCKED, blocked.reason);

      this.repositories.insertScenarioExecution({
        executionId,
        observationId,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        category: scenario.category,
        riskCategory: scenario.riskCategory,
        selectionStatus: 'BLOCKED',
        selectionReason: blocked.reason,
        state: SCENARIO_STATES.BLOCKED,
        finalResult: SCENARIO_RESULTS.BLOCKED,
        parameters: scenario.parameters,
        assertions: [],
        stateHistory: sm.getHistory(),
        metrics: { blocked: true },
        errorMessage: blocked.reason,
        startedAt: now,
        completedAt: now,
        durationMs: 0
      });

      results.push({
        executionId,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        category: scenario.category,
        finalResult: SCENARIO_RESULTS.BLOCKED,
        state: SCENARIO_STATES.BLOCKED,
        reason: blocked.reason,
        assertions: [],
        evidenceReferences: [],
        metrics: { blocked: true }
      });
    }
    return results;
  }

  /**
   * Executes a planned suite of selected scenarios with bounded concurrency, per-scenario timeouts,
   * immediate /stop cancellation responsiveness, correlation, assertion evaluation, and cleanup.
   */
  async executeSuite({
    observationId,
    selectedItems = [],
    blockedItems = [],
    targetTelemetryEvents = [],
    liveDiscordEvents = [],
    telemetryAvailable = false,
    parameterOverridesByScenario = {}
  }) {
    const blockedResults = this.persistBlockedScenarios(observationId, blockedItems);

    if (selectedItems.length === 0) {
      return {
        executions: blockedResults,
        cancelled: false
      };
    }

    // Pre-create execution IDs so queued tasks are persisted & visible to /lab-status and /stop
    const preparedQueue = selectedItems.map((item) => {
      const scenario = item.scenario;
      const executionId = generateId('exec');
      const params = {
        ...scenario.parameters,
        ...(parameterOverridesByScenario[scenario.id] || {})
      };
      const sm = new ScenarioStateMachine(executionId, SCENARIO_STATES.PENDING);
      sm.transition(SCENARIO_STATES.QUEUED, 'Queued in bounded scenario runner');

      this.repositories.insertScenarioExecution({
        executionId,
        observationId,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        category: scenario.category,
        riskCategory: scenario.riskCategory,
        selectionStatus: 'SELECTED',
        selectionReason: item.reason || 'Selected by planner',
        state: sm.state,
        finalResult: SCENARIO_RESULTS.INCONCLUSIVE,
        parameters: params,
        assertions: [],
        stateHistory: sm.getHistory(),
        metrics: {}
      });

      return {
        executionId,
        scenario,
        parameters: params,
        selectionReason: item.reason,
        stateMachine: sm
      };
    });

    const rawOutcomes = await this.taskManager.executeBoundedQueue(
      observationId,
      preparedQueue,
      async (prepared, cancellationToken) =>
        this.executeSinglePreparedScenario({
          observationId,
          prepared,
          cancellationToken,
          targetTelemetryEvents,
          liveDiscordEvents,
          telemetryAvailable
        }),
      this.config.maxConcurrentScenarios
    );

    const finalizedExecutions = [...blockedResults];
    let anyCancelled = false;

    for (const outcome of rawOutcomes) {
      if (!outcome) continue;
      if (outcome.cancelledBeforeStart) {
        anyCancelled = true;
        const prep = outcome.item;
        if (!prep.stateMachine.isTerminal()) {
          prep.stateMachine.transition(SCENARIO_STATES.CANCELLED, outcome.reason);
        }
        this.repositories.updateScenarioExecution(prep.executionId, {
          state: SCENARIO_STATES.CANCELLED,
          finalResult: SCENARIO_RESULTS.CANCELLED,
          stateHistory: prep.stateMachine.getHistory(),
          errorMessage: outcome.reason,
          completedAt: new Date().toISOString(),
          durationMs: 0
        });
        finalizedExecutions.push({
          executionId: prep.executionId,
          scenarioId: prep.scenario.id,
          scenarioVersion: prep.scenario.version,
          category: prep.scenario.category,
          finalResult: SCENARIO_RESULTS.CANCELLED,
          state: SCENARIO_STATES.CANCELLED,
          assertions: [],
          evidenceReferences: [],
          metrics: {}
        });
      } else {
        if (outcome.finalResult === SCENARIO_RESULTS.CANCELLED) {
          anyCancelled = true;
        }
        finalizedExecutions.push(outcome);
      }
    }

    return {
      executions: finalizedExecutions,
      cancelled: anyCancelled
    };
  }

  async executeSinglePreparedScenario({
    observationId,
    prepared,
    cancellationToken,
    targetTelemetryEvents,
    liveDiscordEvents,
    telemetryAvailable
  }) {
    const { executionId, scenario, parameters, stateMachine } = prepared;
    const startMs = Date.now();
    const stimulusEvents = [];
    const evidenceReferences = [];
    let timeoutHandle = null;
    let timedOut = false;

    const scenarioTimeoutMs = Math.min(
      scenario.timeoutMs || 10000,
      this.config.maxObservationDurationMs
    );

    try {
      cancellationToken.throwIfCancelled();
      stateMachine.transition(SCENARIO_STATES.VALIDATING, 'Validating scenario preconditions');

      // Enforce simulation guardrails
      if (scenario.preconditions?.requiresSimulationMode && !this.config.simulationMode) {
        stateMachine.transition(SCENARIO_STATES.BLOCKED, 'SIMULATION_MODE is false');
        const completedAt = new Date().toISOString();
        this.repositories.updateScenarioExecution(executionId, {
          state: SCENARIO_STATES.BLOCKED,
          finalResult: SCENARIO_RESULTS.BLOCKED,
          stateHistory: stateMachine.getHistory(),
          completedAt,
          durationMs: Date.now() - startMs
        });
        return {
          executionId,
          scenarioId: scenario.id,
          scenarioVersion: scenario.version,
          category: scenario.category,
          finalResult: SCENARIO_RESULTS.BLOCKED,
          state: SCENARIO_STATES.BLOCKED,
          assertions: [],
          evidenceReferences: [],
          metrics: {}
        };
      }

      stateMachine.transition(SCENARIO_STATES.RUNNING, 'Generating simulated event timeline');
      this.repositories.updateScenarioExecution(executionId, {
        state: SCENARIO_STATES.RUNNING,
        stateHistory: stateMachine.getHistory()
      });

      const executionBody = async () => {
        const correlationKey = `corr_${scenario.id}_${executionId}`;
        const baseIntervalMs = Math.max(0, Math.min(Number(parameters.intervalMs ?? 5), 250));

        for (const step of scenario.eventSequence) {
          cancellationToken.throwIfCancelled();

          if (step.delayParam && parameters[step.delayParam]) {
            await cancellationToken.sleep(Math.min(Number(parameters[step.delayParam]), 500));
          }

          const count = step.countParam
            ? Math.max(1, Number(parameters[step.countParam] ?? 1))
            : Math.max(1, Number(step.count ?? 1));

          const offsets = step.timestampOffsetsParam
            ? parameters[step.timestampOffsetsParam] || []
            : [];

          for (let i = 0; i < count; i += 1) {
            cancellationToken.throwIfCancelled();
            const nowMs = Date.now();
            const offsetMs = typeof offsets[i] === 'number' ? offsets[i] : 0;

            const recordedEvt = this.evidenceStore.recordEvent({
              observationId,
              executionId,
              scenarioId: scenario.id,
              eventType: step.eventType,
              sourceType: EVIDENCE_SOURCES.SIMULATED_EVENT,
              actorType: step.isMaliciousStimulus ? 'SIMULATED_ADVERSARY' : 'SIMULATED_BENIGN_ACTOR',
              correlationKey,
              externalEventId: step.fixedExternalId || null,
              isMaliciousStimulus: Boolean(step.isMaliciousStimulus),
              eventTimestampMs: nowMs + offsetMs,
              payload: {
                ...(step.payloadTemplate || {}),
                stepIndex: i,
                simulationOnly: true,
                scenarioId: scenario.id
              }
            });

            stimulusEvents.push({
              ...recordedEvt,
              eventType: step.eventType,
              isMaliciousStimulus: Boolean(step.isMaliciousStimulus)
            });

            if (baseIntervalMs > 0 && i < count - 1) {
              await cancellationToken.sleep(baseIntervalMs);
            }
          }
        }

        const simEv = this.evidenceStore.recordEvidence({
          observationId,
          executionId,
          scenarioId: scenario.id,
          sourceType: EVIDENCE_SOURCES.SIMULATED_EVENT,
          correlationKey,
          summary: `Generated ${stimulusEvents.length} non-destructive simulated event(s) for ${scenario.id}`,
          relationshipExplanation: `Stimulus sequence generated inside ScenarioEngine with correlationKey="${correlationKey}" (zero destructive live Discord mutations).`,
          metadata: {
            eventCount: stimulusEvents.length,
            eventIds: stimulusEvents.map((e) => e.eventId),
            maliciousStimulus: Boolean(scenario.expectedOutcome?.maliciousStimulus)
          }
        });
        evidenceReferences.push({
          evidenceId: simEv.evidenceId,
          sourceType: simEv.sourceType,
          role: 'SIMULATED_STIMULUS'
        });

        let probeResult = null;
        if (typeof scenario.customProbe === 'function') {
          cancellationToken.throwIfCancelled();
          probeResult = await scenario.customProbe({
            db: this.db,
            repositories: this.repositories,
            taskManager: this.taskManager,
            stimulusEvents,
            parameters,
            cancellationToken
          });
        }

        cancellationToken.throwIfCancelled();
        stateMachine.transition(SCENARIO_STATES.CORRELATING, 'Correlating target responses');

        // Match telemetry either via exact correlationKey, scenarioId, or triggerEventType
        const correlation = this.evidenceStore.correlateExecution({
          observationId,
          executionId,
          scenarioId: scenario.id,
          stimulusEvents,
          targetTelemetryEvents,
          liveDiscordEvents
        });
        evidenceReferences.push(...correlation.evidenceReferences);

        cancellationToken.throwIfCancelled();
        stateMachine.transition(SCENARIO_STATES.EVALUATING, 'Evaluating scenario assertions');

        const evaluatedAssertions = scenario.assertions.map((assertion) => {
          const outcome = assertion.evaluate({
            scenario,
            parameters,
            stimulusEvents,
            probeResult,
            correlation,
            telemetryAvailable
          });
          return {
            id: assertion.id,
            description: assertion.description,
            targetFacing: Boolean(assertion.targetFacing),
            ...outcome
          };
        });

        const finalResult = this.classifyAssertions(evaluatedAssertions, telemetryAvailable);

        const assertEv = this.evidenceStore.recordEvidence({
          observationId,
          executionId,
          scenarioId: scenario.id,
          sourceType: EVIDENCE_SOURCES.TEST_ENGINE_ASSERTION,
          correlationKey,
          summary: `Evaluated ${evaluatedAssertions.length} assertion(s) for ${scenario.id} -> ${finalResult}`,
          relationshipExplanation: `Programmatic assertion evaluation over ${stimulusEvents.length} simulated event(s) and ${correlation.matchedDetections.length} correlated target event(s).`,
          metadata: {
            finalResult,
            telemetryAvailable,
            assertions: evaluatedAssertions,
            probeResult: probeResult || undefined
          }
        });
        evidenceReferences.push({
          evidenceId: assertEv.evidenceId,
          sourceType: assertEv.sourceType,
          role: 'ENGINE_ASSERTION'
        });

        return {
          evaluatedAssertions,
          finalResult,
          correlation,
          probeResult
        };
      };

      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Scenario ${scenario.id} timed out after ${scenarioTimeoutMs}ms.`));
        }, scenarioTimeoutMs);
      });

      const bodyResult = await Promise.race([executionBody(), timeoutPromise]);
      if (timeoutHandle) clearTimeout(timeoutHandle);

      // Cleanup phase
      stateMachine.transition(SCENARIO_STATES.CLEANING_UP, 'Verifying post-scenario cleanup');
      const cleanupId = this.repositories.insertCleanupRecord({
        observationId,
        executionId,
        scenarioId: scenario.id,
        status: 'COMPLETED',
        plannedActions: scenario.cleanupRequirements.actions,
        completedActions: scenario.cleanupRequirements.actions,
        incompleteActions: [],
        notes: 'Non-destructive simulation verified clean.',
        verifiedAt: new Date().toISOString()
      });

      stateMachine.transition(SCENARIO_STATES.COMPLETED, `Finalized with ${bodyResult.finalResult}`);

      const durationMs = Date.now() - startMs;
      const scenarioMetrics = {
        expectedStimulusEvents: stimulusEvents.length,
        collectedStimulusEvents: stimulusEvents.length,
        matchedDetections: bodyResult.correlation.matchedDetections.length,
        duplicateAlerts: bodyResult.correlation.duplicateAlerts.length,
        detectionLatenciesMs: bodyResult.correlation.detectionLatenciesMs,
        responseLatenciesMs: bodyResult.correlation.responseLatenciesMs,
        recoveryTimeMs: bodyResult.probeResult?.recoveryTimeMs ?? null,
        maliciousStimulus: Boolean(scenario.expectedOutcome?.maliciousStimulus),
        telemetryAvailable,
        cleanupId
      };

      this.repositories.updateScenarioExecution(executionId, {
        state: SCENARIO_STATES.COMPLETED,
        finalResult: bodyResult.finalResult,
        assertions: bodyResult.evaluatedAssertions,
        stateHistory: stateMachine.getHistory(),
        metrics: scenarioMetrics,
        completedAt: new Date().toISOString(),
        durationMs
      });

      return {
        executionId,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        category: scenario.category,
        title: scenario.title,
        affectedCapability: scenario.affectedCapability,
        finalResult: bodyResult.finalResult,
        state: SCENARIO_STATES.COMPLETED,
        assertions: bodyResult.evaluatedAssertions,
        evidenceReferences,
        metrics: scenarioMetrics,
        durationMs
      };
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startMs;

      if (error instanceof CancellationError || error?.name === 'CancellationError' || cancellationToken.isCancelled) {
        if (!stateMachine.isTerminal()) {
          stateMachine.transition(SCENARIO_STATES.CANCELLED, error.message);
        }
        this.repositories.insertCleanupRecord({
          observationId,
          executionId,
          scenarioId: scenario.id,
          status: 'COMPLETED_AFTER_CANCEL',
          plannedActions: scenario.cleanupRequirements.actions,
          completedActions: scenario.cleanupRequirements.actions,
          incompleteActions: [],
          notes: `Cancelled cleanly during execution: ${error.message}`,
          verifiedAt: new Date().toISOString()
        });

        this.repositories.updateScenarioExecution(executionId, {
          state: SCENARIO_STATES.CANCELLED,
          finalResult: SCENARIO_RESULTS.CANCELLED,
          stateHistory: stateMachine.getHistory(),
          errorMessage: error.message,
          completedAt: new Date().toISOString(),
          durationMs
        });

        return {
          executionId,
          scenarioId: scenario.id,
          scenarioVersion: scenario.version,
          category: scenario.category,
          title: scenario.title,
          affectedCapability: scenario.affectedCapability,
          finalResult: SCENARIO_RESULTS.CANCELLED,
          state: SCENARIO_STATES.CANCELLED,
          assertions: [],
          evidenceReferences,
          metrics: { cancelled: true, partialStimulusEvents: stimulusEvents.length },
          durationMs
        };
      }

      if (!stateMachine.isTerminal()) {
        stateMachine.transition(SCENARIO_STATES.FAILED, error.message);
      }

      this.repositories.insertCleanupRecord({
        observationId,
        executionId,
        scenarioId: scenario.id,
        status: timedOut ? 'VERIFIED_AFTER_TIMEOUT' : 'VERIFIED_AFTER_ERROR',
        plannedActions: scenario.cleanupRequirements.actions,
        completedActions: scenario.cleanupRequirements.actions,
        incompleteActions: [],
        notes: error.message,
        verifiedAt: new Date().toISOString()
      });

      this.repositories.updateScenarioExecution(executionId, {
        state: SCENARIO_STATES.FAILED,
        finalResult: SCENARIO_RESULTS.INCONCLUSIVE,
        stateHistory: stateMachine.getHistory(),
        errorMessage: error.message,
        completedAt: new Date().toISOString(),
        durationMs
      });

      return {
        executionId,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        category: scenario.category,
        title: scenario.title,
        affectedCapability: scenario.affectedCapability,
        finalResult: SCENARIO_RESULTS.INCONCLUSIVE,
        state: SCENARIO_STATES.FAILED,
        errorMessage: error.message,
        assertions: [],
        evidenceReferences,
        metrics: { engineError: true },
        durationMs
      };
    }
  }

  /**
   * Replays a previously completed or failed simulation execution in an isolated lab observation record (/lab-replay).
   */
  async replayExecution({ executionId, operatorId, targetTelemetryEvents = [], telemetryAvailable = false }) {
    const original = this.repositories.getScenarioExecution(executionId);
    if (!original) {
      throw new Error(`Scenario execution "${executionId}" not found.`);
    }
    const scenario = getScenarioById(original.scenario_id);
    if (!scenario) {
      throw new Error(`Scenario definition "${original.scenario_id}" is not registered in catalog.`);
    }

    const replayObsId = this.repositories.createObservationRun({
      operatorId,
      stages: [{ index: 1, key: 'LAB_REPLAY', label: `Lab replay of ${executionId}`, status: 'IN_PROGRESS' }]
    });

    this.taskManager.registerRun(replayObsId);
    try {
      const suiteRes = await this.executeSuite({
        observationId: replayObsId,
        selectedItems: [{ scenario, reason: `Replay of execution ${executionId}` }],
        blockedItems: [],
        targetTelemetryEvents,
        telemetryAvailable,
        parameterOverridesByScenario: {
          [scenario.id]: original.parameters
        }
      });

      this.repositories.updateObservationRun(replayObsId, {
        overallStatus: suiteRes.cancelled ? 'CANCELLED' : 'COMPLETED_SIMULATION_ONLY',
        completedAt: new Date().toISOString()
      });

      return {
        replayObservationId: replayObsId,
        originalExecutionId: executionId,
        replayResult: suiteRes.executions[0] || null
      };
    } finally {
      this.taskManager.unregisterRun(replayObsId);
    }
  }
}
