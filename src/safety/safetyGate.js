import { ASSESSMENT_STATES, TARGET_IDENTIFICATION_STATES } from '../utils/constants.js';
import { isValidSnowflake, sha256Hex } from '../utils/ids.js';

export class SafetyViolationError extends Error {
  constructor(message, failedSafeguards = []) {
    super(message);
    this.name = 'SafetyViolationError';
    this.failedSafeguards = failedSafeguards;
  }
}

export class SafetyGate {
  constructor({ config, taskManager = null, logger = null }) {
    this.config = config;
    this.taskManager = taskManager;
    this.logger = logger;
  }

  isGuildAllowlisted(guildId) {
    if (!this.config.requireTestGuildAllowlist) {
      return true;
    }
    if (!guildId || !isValidSnowflake(String(guildId))) {
      return false;
    }
    return this.config.testGuildAllowlist.includes(String(guildId));
  }

  /**
   * Evaluates all 8 Part-10 safeguards after an observation run finishes.
   * Never automatically triggers a test; sets READY_FOR_APPROVAL only when all safeguards hold.
   */
  evaluateEligibility({
    operatorId,
    guildId,
    targetDiscovery,
    selectedScenarios = [],
    taskManagerHealthy = null
  }) {
    const stopOperational =
      taskManagerHealthy !== null
        ? Boolean(taskManagerHealthy)
        : Boolean(this.taskManager && typeof this.taskManager.stopAll === 'function');

    const cleanupPlanValid =
      selectedScenarios.length > 0 &&
      selectedScenarios.every(
        (s) =>
          s.cleanupRequirements &&
          Array.isArray(s.cleanupRequirements.actions) &&
          typeof s.cleanupRequirements.reversible === 'boolean'
      );

    const safeguards = {
      operatorIdentity:
        Boolean(this.config.privilegedEnabled) &&
        isValidSnowflake(String(operatorId || '')) &&
        String(operatorId) === this.config.authorizedOperatorId,
      targetGuildAllowlist: this.isGuildAllowlisted(guildId),
      targetIntegration:
        targetDiscovery?.state === TARGET_IDENTIFICATION_STATES.VERIFIED &&
        Boolean(targetDiscovery?.botId),
      scenarioSelection: Array.isArray(selectedScenarios) && selectedScenarios.length > 0,
      executionLimits:
        this.config.maxConcurrentScenarios >= 1 &&
        this.config.maxConcurrentScenarios <= 10 &&
        this.config.maxObservationDurationMinutes >= 1 &&
        this.config.maxObservationDurationMinutes <= 60,
      cleanupPlan: cleanupPlanValid,
      stopMechanism: stopOperational,
      safetyConfiguration:
        Boolean(this.config.validation?.valid) && Boolean(this.config.privilegedEnabled)
    };

    const failedSafeguards = Object.entries(safeguards)
      .filter(([, passed]) => !passed)
      .map(([key]) => key);

    const reasons = [];
    if (!safeguards.operatorIdentity) {
      reasons.push('Operator identity could not be verified against AUTHORIZED_OPERATOR_ID.');
    }
    if (!safeguards.targetGuildAllowlist) {
      reasons.push(
        guildId
          ? `Guild ID ${guildId} is not present in TEST_GUILD_ALLOWLIST / DEV_GUILD_ID while REQUIRE_TEST_GUILD_ALLOWLIST=true.`
          : 'No guild context is available to satisfy REQUIRE_TEST_GUILD_ALLOWLIST=true.'
      );
    }
    if (!safeguards.targetIntegration) {
      reasons.push(
        `Target Astra Astra identity/integration is not verified (current state: ${targetDiscovery?.state || 'UNKNOWN'}).`
      );
    }
    if (!safeguards.scenarioSelection) {
      reasons.push('No eligible controlled scenarios were selected for execution.');
    }
    if (!safeguards.executionLimits) {
      reasons.push('Execution concurrency or duration limits are outside safe bounds.');
    }
    if (!safeguards.cleanupPlan) {
      reasons.push('One or more selected scenarios lack a verified deterministic cleanup plan.');
    }
    if (!safeguards.stopMechanism) {
      reasons.push('Emergency /stop task manager is not verified operational.');
    }
    if (!safeguards.safetyConfiguration) {
      reasons.push('Platform safety configuration failed startup validation.');
    }

    const eligible = failedSafeguards.length === 0;
    const assessmentState = eligible
      ? ASSESSMENT_STATES.READY_FOR_APPROVAL
      : ASSESSMENT_STATES.NOT_ELIGIBLE;

    const selectedScenarioIds = selectedScenarios.map((s) => `${s.id}@${s.version}`);
    const scopeFingerprint = sha256Hex({
      operatorId: this.config.authorizedOperatorId,
      guildId: guildId || null,
      targetBotId: targetDiscovery?.botId || null,
      selectedScenarioIds
    });

    const summaryWhatItWillDo = eligible
      ? `Execute ${selectedScenarios.length} bounded, non-destructive controlled security verification scenario(s) (${selectedScenarios
          .slice(0, 6)
          .map((s) => s.id)
          .join(', ')}${selectedScenarios.length > 6 ? ', ...' : ''}) in guild ${guildId} against verified target ${targetDiscovery.botName} (${targetDiscovery.botId}) with max concurrency ${this.config.maxConcurrentScenarios}, max duration ${this.config.maxObservationDurationMinutes}m, automatic cleanup verification, and instant /stop cancellation.`
      : 'Controlled test execution is unavailable until all listed safety prerequisites are satisfied.';

    return {
      eligible,
      assessmentState,
      safeguards,
      failedSafeguards,
      reasons,
      scopeFingerprint,
      selectedScenarioIds,
      summaryWhatItWillDo
    };
  }

  /**
   * Revalidates all 8 safeguards immediately before approving a separate controlled test.
   * Ensures approval applies ONLY to the exact described test scopeFingerprint.
   */
  revalidateApproval({
    invokingUserId,
    observationRun,
    selectedScenarios,
    expectedScopeFingerprint
  }) {
    if (!observationRun) {
      throw new SafetyViolationError('Cannot approve controlled test: observation run does not exist.', [
        'missingObservationRun'
      ]);
    }
    if (observationRun.assessment_state !== ASSESSMENT_STATES.READY_FOR_APPROVAL) {
      throw new SafetyViolationError(
        `Observation ${observationRun.observation_id} is in state "${observationRun.assessment_state}", not READY_FOR_APPROVAL.`,
        ['invalidAssessmentState']
      );
    }

    const targetDiscovery = observationRun.environment?.targetDiscovery || {
      state: observationRun.target_identification_state,
      botId: observationRun.target_bot_id,
      botName: observationRun.target_bot_name
    };

    const recheck = this.evaluateEligibility({
      operatorId: invokingUserId,
      guildId: observationRun.guild_id,
      targetDiscovery,
      selectedScenarios
    });

    if (!recheck.eligible) {
      throw new SafetyViolationError(
        `Controlled test approval rejected during revalidation: ${recheck.reasons.join(' ')}`,
        recheck.failedSafeguards
      );
    }

    const persistedFingerprint = observationRun.approvalSummary?.scopeFingerprint;
    if (
      !persistedFingerprint ||
      recheck.scopeFingerprint !== persistedFingerprint ||
      (expectedScopeFingerprint && expectedScopeFingerprint !== persistedFingerprint)
    ) {
      throw new SafetyViolationError(
        'Controlled test scope fingerprint mismatch. Approval applies strictly to the originally described observation scope.',
        ['scopeFingerprintMismatch']
      );
    }

    this.logger?.info('Revalidated all 8 Part-10 safeguards for controlled test approval', {
      observationId: observationRun.observation_id,
      scopeFingerprint: recheck.scopeFingerprint
    });

    return {
      approved: true,
      observationId: observationRun.observation_id,
      scopeFingerprint: recheck.scopeFingerprint,
      revalidatedAt: new Date().toISOString(),
      safeguards: recheck.safeguards
    };
  }
}
