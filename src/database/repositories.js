import { generateId, sha256Hex } from '../utils/ids.js';

function parseJsonSafe(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export class PlatformRepositories {
  constructor(dbManager) {
    this.db = dbManager;
  }

  // 1. Configuration Metadata
  recordConfigSnapshot(sanitizedConfig) {
    const configId = generateId('cfg');
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO configuration_metadata (
        config_id, app_version, operator_id, simulation_mode, require_allowlist,
        max_concurrent_scenarios, max_observation_minutes, sanitized_snapshot_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      configId,
      sanitizedConfig.appVersion || '1.0.0',
      sanitizedConfig.authorizedOperatorId || 'UNSET',
      sanitizedConfig.simulationMode ? 1 : 0,
      sanitizedConfig.requireTestGuildAllowlist ? 1 : 0,
      sanitizedConfig.maxConcurrentScenarios,
      sanitizedConfig.maxObservationDurationMinutes,
      JSON.stringify(sanitizedConfig),
      now
    );
    return configId;
  }

  // 2. Authorization Audit Records
  insertAuthAudit({
    invokingUserId,
    configuredOperatorId,
    interactionType,
    actionName,
    guildId = null,
    channelId = null,
    decision,
    reason,
    metadata = {}
  }) {
    const auditId = generateId('aud');
    const createdAt = new Date().toISOString();
    this.db.run(
      `INSERT INTO authorization_audit_records (
        audit_id, invoking_user_id, configured_operator_id, interaction_type,
        action_name, guild_id, channel_id, decision, reason, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      auditId,
      String(invokingUserId || 'UNKNOWN'),
      String(configuredOperatorId || 'UNSET'),
      String(interactionType || 'unknown'),
      String(actionName || 'unknown'),
      guildId ? String(guildId) : null,
      channelId ? String(channelId) : null,
      decision,
      reason,
      JSON.stringify(metadata || {}),
      createdAt
    );
    return { auditId, createdAt };
  }

  listAuthAudits({ decision = null, limit = 50 } = {}) {
    const rows = decision
      ? this.db.all(
          'SELECT * FROM authorization_audit_records WHERE decision = ? ORDER BY created_at DESC LIMIT ?',
          decision,
          limit
        )
      : this.db.all(
          'SELECT * FROM authorization_audit_records ORDER BY created_at DESC LIMIT ?',
          limit
        );
    return rows.map((r) => ({
      ...r,
      metadata: parseJsonSafe(r.metadata_json, {})
    }));
  }

  // 3. Scenario Definitions
  syncScenarioDefinitions(scenarios) {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const s of scenarios) {
        const serializable = {
          id: s.id,
          version: s.version,
          name: s.name,
          title: s.title,
          description: s.description,
          category: s.category,
          riskCategory: s.riskCategory,
          preconditions: s.preconditions,
          parameters: s.parameters,
          expectedOutcome: s.expectedOutcome,
          timeoutMs: s.timeoutMs,
          cancellationBehavior: s.cancellationBehavior,
          cleanupRequirements: s.cleanupRequirements
        };
        this.db.run(
          `INSERT INTO scenario_definitions (
            scenario_id, version, name, title, category, risk_category, timeout_ms, definition_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(scenario_id, version) DO UPDATE SET
            name = excluded.name,
            title = excluded.title,
            category = excluded.category,
            risk_category = excluded.risk_category,
            timeout_ms = excluded.timeout_ms,
            definition_json = excluded.definition_json,
            updated_at = excluded.updated_at`,
          s.id,
          s.version,
          s.name,
          s.title,
          s.category,
          s.riskCategory,
          s.timeoutMs,
          JSON.stringify(serializable),
          now
        );
      }
    });
  }

  listScenarioDefinitions() {
    return this.db
      .all('SELECT * FROM scenario_definitions ORDER BY scenario_id ASC')
      .map((r) => ({
        ...r,
        definition: parseJsonSafe(r.definition_json, {})
      }));
  }

  // 4. Observation Runs
  createObservationRun({
    observationId = generateId('obs'),
    operatorId,
    guildId = null,
    guildName = null,
    stages = [],
    startedAt = new Date().toISOString()
  }) {
    this.db.run(
      `INSERT INTO observation_runs (
        observation_id, operator_id, guild_id, guild_name,
        target_bot_name, target_bot_id, target_identification_state,
        integration_status, overall_status, assessment_state,
        current_stage_index, last_successful_stage, failed_stage,
        failure_category, failure_message, stages_json, environment_json,
        plan_json, metrics_json, limitations_json, approval_summary_json,
        started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      observationId,
      operatorId,
      guildId,
      guildName,
      null,
      null,
      'UNCONFIGURED',
      'PENDING_DISCOVERY',
      'INITIALIZING',
      'NOT_ELIGIBLE',
      1,
      null,
      null,
      null,
      null,
      JSON.stringify(stages),
      JSON.stringify({}),
      JSON.stringify({}),
      JSON.stringify({}),
      JSON.stringify([]),
      JSON.stringify({}),
      startedAt,
      null
    );
    return observationId;
  }

  updateObservationRun(observationId, patch) {
    const existing = this.getObservationRun(observationId);
    if (!existing) {
      throw new Error(`Observation run "${observationId}" not found.`);
    }

    const merged = {
      guildId: patch.guildId !== undefined ? patch.guildId : existing.guild_id,
      guildName: patch.guildName !== undefined ? patch.guildName : existing.guild_name,
      targetBotName: patch.targetBotName !== undefined ? patch.targetBotName : existing.target_bot_name,
      targetBotId: patch.targetBotId !== undefined ? patch.targetBotId : existing.target_bot_id,
      targetIdentificationState:
        patch.targetIdentificationState !== undefined
          ? patch.targetIdentificationState
          : existing.target_identification_state,
      integrationStatus:
        patch.integrationStatus !== undefined ? patch.integrationStatus : existing.integration_status,
      overallStatus: patch.overallStatus !== undefined ? patch.overallStatus : existing.overall_status,
      assessmentState:
        patch.assessmentState !== undefined ? patch.assessmentState : existing.assessment_state,
      currentStageIndex:
        patch.currentStageIndex !== undefined ? patch.currentStageIndex : existing.current_stage_index,
      lastSuccessfulStage:
        patch.lastSuccessfulStage !== undefined
          ? patch.lastSuccessfulStage
          : existing.last_successful_stage,
      failedStage: patch.failedStage !== undefined ? patch.failedStage : existing.failed_stage,
      failureCategory:
        patch.failureCategory !== undefined ? patch.failureCategory : existing.failure_category,
      failureMessage:
        patch.failureMessage !== undefined ? patch.failureMessage : existing.failure_message,
      stages: patch.stages !== undefined ? patch.stages : existing.stages,
      environment: patch.environment !== undefined ? patch.environment : existing.environment,
      plan: patch.plan !== undefined ? patch.plan : existing.plan,
      metrics: patch.metrics !== undefined ? patch.metrics : existing.metrics,
      limitations: patch.limitations !== undefined ? patch.limitations : existing.limitations,
      approvalSummary:
        patch.approvalSummary !== undefined ? patch.approvalSummary : existing.approvalSummary,
      completedAt: patch.completedAt !== undefined ? patch.completedAt : existing.completed_at
    };

    this.db.run(
      `UPDATE observation_runs SET
        guild_id = ?, guild_name = ?, target_bot_name = ?, target_bot_id = ?,
        target_identification_state = ?, integration_status = ?, overall_status = ?,
        assessment_state = ?, current_stage_index = ?, last_successful_stage = ?,
        failed_stage = ?, failure_category = ?, failure_message = ?,
        stages_json = ?, environment_json = ?, plan_json = ?, metrics_json = ?,
        limitations_json = ?, approval_summary_json = ?, completed_at = ?
      WHERE observation_id = ?`,
      merged.guildId,
      merged.guildName,
      merged.targetBotName,
      merged.targetBotId,
      merged.targetIdentificationState,
      merged.integrationStatus,
      merged.overallStatus,
      merged.assessmentState,
      merged.currentStageIndex,
      merged.lastSuccessfulStage,
      merged.failedStage,
      merged.failureCategory,
      merged.failureMessage,
      JSON.stringify(merged.stages),
      JSON.stringify(merged.environment),
      JSON.stringify(merged.plan),
      JSON.stringify(merged.metrics),
      JSON.stringify(merged.limitations),
      JSON.stringify(merged.approvalSummary),
      merged.completedAt,
      observationId
    );
  }

  hydrateObservationRow(row) {
    if (!row) return null;
    return {
      ...row,
      stages: parseJsonSafe(row.stages_json, []),
      environment: parseJsonSafe(row.environment_json, {}),
      plan: parseJsonSafe(row.plan_json, {}),
      metrics: parseJsonSafe(row.metrics_json, {}),
      limitations: parseJsonSafe(row.limitations_json, []),
      approvalSummary: parseJsonSafe(row.approval_summary_json, {})
    };
  }

  getObservationRun(observationId) {
    const row = this.db.get(
      'SELECT * FROM observation_runs WHERE observation_id = ?',
      observationId
    );
    return this.hydrateObservationRow(row);
  }

  getLatestObservationRun() {
    const row = this.db.get(
      'SELECT * FROM observation_runs ORDER BY started_at DESC, rowid DESC LIMIT 1'
    );
    return this.hydrateObservationRow(row);
  }

  listObservationRuns(limit = 20) {
    return this.db
      .all('SELECT * FROM observation_runs ORDER BY started_at DESC, rowid DESC LIMIT ?', limit)
      .map((r) => this.hydrateObservationRow(r));
  }

  findUnfinishedObservationRuns() {
    return this.db
      .all(
        `SELECT * FROM observation_runs
         WHERE overall_status IN ('INITIALIZING', 'RUNNING') OR completed_at IS NULL`
      )
      .map((r) => this.hydrateObservationRow(r));
  }

  // 5. Scenario Executions
  insertScenarioExecution({
    executionId = generateId('exec'),
    observationId,
    scenarioId,
    scenarioVersion,
    category,
    riskCategory,
    selectionStatus = 'SELECTED',
    selectionReason = '',
    state = 'PENDING',
    finalResult = 'INCONCLUSIVE',
    parameters = {},
    assertions = [],
    stateHistory = [],
    metrics = {},
    errorMessage = null,
    startedAt = new Date().toISOString(),
    completedAt = null,
    durationMs = null
  }) {
    this.db.run(
      `INSERT INTO scenario_executions (
        execution_id, observation_id, scenario_id, scenario_version,
        category, risk_category, selection_status, selection_reason,
        state, final_result, parameters_json, assertions_json,
        state_history_json, metrics_json, error_message,
        started_at, completed_at, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      executionId,
      observationId,
      scenarioId,
      scenarioVersion,
      category,
      riskCategory,
      selectionStatus,
      selectionReason,
      state,
      finalResult,
      JSON.stringify(parameters),
      JSON.stringify(assertions),
      JSON.stringify(stateHistory),
      JSON.stringify(metrics),
      errorMessage,
      startedAt,
      completedAt,
      durationMs
    );
    return executionId;
  }

  updateScenarioExecution(executionId, patch) {
    const existing = this.getScenarioExecution(executionId);
    if (!existing) {
      throw new Error(`Scenario execution "${executionId}" not found.`);
    }

    const state = patch.state !== undefined ? patch.state : existing.state;
    const finalResult = patch.finalResult !== undefined ? patch.finalResult : existing.final_result;
    const assertions = patch.assertions !== undefined ? patch.assertions : existing.assertions;
    const stateHistory =
      patch.stateHistory !== undefined ? patch.stateHistory : existing.stateHistory;
    const metrics = patch.metrics !== undefined ? patch.metrics : existing.metrics;
    const errorMessage =
      patch.errorMessage !== undefined ? patch.errorMessage : existing.error_message;
    const completedAt =
      patch.completedAt !== undefined ? patch.completedAt : existing.completed_at;
    const durationMs = patch.durationMs !== undefined ? patch.durationMs : existing.duration_ms;

    this.db.run(
      `UPDATE scenario_executions SET
        state = ?, final_result = ?, assertions_json = ?, state_history_json = ?,
        metrics_json = ?, error_message = ?, completed_at = ?, duration_ms = ?
      WHERE execution_id = ?`,
      state,
      finalResult,
      JSON.stringify(assertions),
      JSON.stringify(stateHistory),
      JSON.stringify(metrics),
      errorMessage,
      completedAt,
      durationMs,
      executionId
    );
  }

  hydrateExecutionRow(row) {
    if (!row) return null;
    return {
      ...row,
      parameters: parseJsonSafe(row.parameters_json, {}),
      assertions: parseJsonSafe(row.assertions_json, []),
      stateHistory: parseJsonSafe(row.state_history_json, []),
      metrics: parseJsonSafe(row.metrics_json, {})
    };
  }

  getScenarioExecution(executionId) {
    const row = this.db.get(
      'SELECT * FROM scenario_executions WHERE execution_id = ?',
      executionId
    );
    return this.hydrateExecutionRow(row);
  }

  listScenarioExecutionsByObservation(observationId) {
    return this.db
      .all(
        'SELECT * FROM scenario_executions WHERE observation_id = ? ORDER BY started_at ASC, rowid ASC',
        observationId
      )
      .map((r) => this.hydrateExecutionRow(r));
  }

  listRecentScenarioFailures(limit = 50) {
    return this.db
      .all(
        `SELECT scenario_id, final_result, started_at
         FROM scenario_executions
         WHERE final_result IN ('FAIL', 'PARTIAL')
         ORDER BY started_at DESC
         LIMIT ?`,
        limit
      );
  }

  // 6. Normalized Events
  insertNormalizedEvent({
    eventId = generateId('evt'),
    observationId,
    executionId = null,
    scenarioId = null,
    sequenceNo,
    eventType,
    sourceType,
    actorType = 'SIMULATOR',
    correlationKey = null,
    isDuplicate = false,
    isMaliciousStimulus = false,
    eventTimestampMs,
    payload = {}
  }) {
    const recordedAt = new Date().toISOString();
    this.db.run(
      `INSERT INTO normalized_events (
        event_id, observation_id, execution_id, scenario_id, sequence_no,
        event_type, source_type, actor_type, correlation_key, is_duplicate,
        is_malicious_stimulus, event_timestamp_ms, payload_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      eventId,
      observationId,
      executionId,
      scenarioId,
      sequenceNo,
      eventType,
      sourceType,
      actorType,
      correlationKey,
      isDuplicate ? 1 : 0,
      isMaliciousStimulus ? 1 : 0,
      eventTimestampMs,
      JSON.stringify(payload),
      recordedAt
    );
    return eventId;
  }

  listEventsByObservation(observationId) {
    return this.db
      .all(
        'SELECT * FROM normalized_events WHERE observation_id = ? ORDER BY sequence_no ASC, event_timestamp_ms ASC',
        observationId
      )
      .map((r) => ({
        ...r,
        is_duplicate: Boolean(r.is_duplicate),
        is_malicious_stimulus: Boolean(r.is_malicious_stimulus),
        payload: parseJsonSafe(r.payload_json, {})
      }));
  }

  listEventsByExecution(executionId) {
    return this.db
      .all(
        'SELECT * FROM normalized_events WHERE execution_id = ? ORDER BY sequence_no ASC, event_timestamp_ms ASC',
        executionId
      )
      .map((r) => ({
        ...r,
        is_duplicate: Boolean(r.is_duplicate),
        is_malicious_stimulus: Boolean(r.is_malicious_stimulus),
        payload: parseJsonSafe(r.payload_json, {})
      }));
  }

  // 7. Evidence Records
  insertEvidenceRecord({
    evidenceId = generateId('evd'),
    observationId,
    executionId = null,
    scenarioId = null,
    sourceType,
    correlationKey = null,
    summary,
    relationshipExplanation,
    metadata = {},
    collectedAt = new Date().toISOString()
  }) {
    const sha256Hash = sha256Hex({
      sourceType,
      correlationKey,
      summary,
      relationshipExplanation,
      metadata
    });

    this.db.run(
      `INSERT INTO evidence_records (
        evidence_id, observation_id, execution_id, scenario_id,
        source_type, correlation_key, sha256_hash, summary,
        relationship_explanation, metadata_json, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      evidenceId,
      observationId,
      executionId,
      scenarioId,
      sourceType,
      correlationKey,
      sha256Hash,
      summary,
      relationshipExplanation,
      JSON.stringify(metadata),
      collectedAt
    );

    return { evidenceId, sha256Hash, sourceType, collectedAt };
  }

  listEvidenceByObservation(observationId) {
    return this.db
      .all(
        'SELECT * FROM evidence_records WHERE observation_id = ? ORDER BY collected_at ASC, rowid ASC',
        observationId
      )
      .map((r) => ({
        ...r,
        metadata: parseJsonSafe(r.metadata_json, {})
      }));
  }

  // 8. Security Findings
  insertFinding(finding) {
    const findingId = finding.findingId || generateId('fnd');
    const createdAt = finding.createdAt || new Date().toISOString();
    this.db.run(
      `INSERT INTO findings (
        finding_id, observation_id, execution_id, scenario_id, classification,
        title, severity, confidence, affected_capability, evidence_refs_json,
        expected_behavior, observed_behavior, potential_impact,
        reproduction_procedure, recommended_fix, regression_test,
        verification_status, recommendation_detail_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      findingId,
      finding.observationId,
      finding.executionId || null,
      finding.scenarioId,
      finding.classification,
      finding.title,
      finding.severity,
      finding.confidence,
      finding.affectedCapability,
      JSON.stringify(finding.evidenceReferences || []),
      finding.expectedBehavior,
      finding.observedBehavior,
      finding.potentialImpact,
      finding.reproductionProcedure,
      finding.recommendedFix,
      finding.regressionTest,
      finding.verificationStatus,
      JSON.stringify(finding.recommendationDetail || {}),
      createdAt
    );
    return findingId;
  }

  listFindingsByObservation(observationId) {
    return this.db
      .all(
        'SELECT * FROM findings WHERE observation_id = ? ORDER BY rowid ASC',
        observationId
      )
      .map((r) => ({
        ...r,
        findingId: r.finding_id,
        observationId: r.observation_id,
        executionId: r.execution_id,
        scenarioId: r.scenario_id,
        affectedCapability: r.affected_capability,
        evidenceReferences: parseJsonSafe(r.evidence_refs_json, []),
        expectedBehavior: r.expected_behavior,
        observedBehavior: r.observed_behavior,
        potentialImpact: r.potential_impact,
        reproductionProcedure: r.reproduction_procedure,
        recommendedFix: r.recommended_fix,
        regressionTest: r.regression_test,
        verificationStatus: r.verification_status,
        recommendationDetail: parseJsonSafe(r.recommendation_detail_json, {})
      }));
  }

  listRecentOpenFindings(limit = 50) {
    return this.db
      .all(
        `SELECT * FROM findings
         WHERE classification IN ('CONFIRMED_DEFECT', 'SUSPECTED_WEAKNESS')
         ORDER BY created_at DESC LIMIT ?`,
        limit
      )
      .map((r) => ({
        ...r,
        scenarioId: r.scenario_id,
        evidenceReferences: parseJsonSafe(r.evidence_refs_json, [])
      }));
  }

  // 9. Reports
  upsertReport({
    reportId = generateId('rpt'),
    observationId,
    reportType = 'OBSERVATION_REPORT',
    structuredReport,
    renderedMarkdown,
    dmDeliveryStatus = 'PENDING',
    dmDeliveredAt = null,
    fallbackStatus = null,
    archivePath = null
  }) {
    const now = new Date().toISOString();
    const sha256Hash = sha256Hex(renderedMarkdown);
    const existing = this.getReportByObservation(observationId);

    if (existing) {
      this.db.run(
        `UPDATE reports SET
          report_type = ?, sha256_hash = ?, structured_json = ?, rendered_markdown = ?,
          dm_delivery_status = ?, dm_delivered_at = ?, fallback_status = ?, archive_path = ?,
          updated_at = ?
         WHERE observation_id = ?`,
        reportType,
        sha256Hash,
        JSON.stringify(structuredReport),
        renderedMarkdown,
        dmDeliveryStatus,
        dmDeliveredAt,
        fallbackStatus,
        archivePath,
        now,
        observationId
      );
      return existing.report_id;
    }

    this.db.run(
      `INSERT INTO reports (
        report_id, observation_id, report_type, sha256_hash, structured_json,
        rendered_markdown, dm_delivery_status, dm_delivered_at, fallback_status,
        archive_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reportId,
      observationId,
      reportType,
      sha256Hash,
      JSON.stringify(structuredReport),
      renderedMarkdown,
      dmDeliveryStatus,
      dmDeliveredAt,
      fallbackStatus,
      archivePath,
      now,
      now
    );
    return reportId;
  }

  getReportByObservation(observationId) {
    const row = this.db.get('SELECT * FROM reports WHERE observation_id = ?', observationId);
    if (!row) return null;
    return {
      ...row,
      structured: parseJsonSafe(row.structured_json, {})
    };
  }

  getLatestReport() {
    const row = this.db.get('SELECT * FROM reports ORDER BY created_at DESC, rowid DESC LIMIT 1');
    if (!row) return null;
    return {
      ...row,
      structured: parseJsonSafe(row.structured_json, {})
    };
  }

  // 10. Regression Baselines
  saveRegressionBaseline({
    baselineId = generateId('base'),
    observationId,
    guildId = null,
    targetBotId = null,
    targetVersion = null,
    scenarioOutcomes = {},
    metricsSnapshot = {}
  }) {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      if (guildId) {
        this.db.run('UPDATE regression_baselines SET is_active = 0 WHERE guild_id = ?', guildId);
      } else {
        this.db.run('UPDATE regression_baselines SET is_active = 0 WHERE guild_id IS NULL');
      }

      this.db.run(
        `INSERT INTO regression_baselines (
          baseline_id, observation_id, guild_id, target_bot_id, target_version,
          is_active, scenario_outcomes_json, metrics_snapshot_json, created_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        baselineId,
        observationId,
        guildId,
        targetBotId,
        targetVersion,
        JSON.stringify(scenarioOutcomes),
        JSON.stringify(metricsSnapshot),
        now
      );
    });
    return baselineId;
  }

  getActiveBaseline(guildId = null) {
    const row = guildId
      ? this.db.get(
          'SELECT * FROM regression_baselines WHERE is_active = 1 AND guild_id = ? ORDER BY created_at DESC LIMIT 1',
          guildId
        )
      : this.db.get(
          'SELECT * FROM regression_baselines WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1'
        );
    if (!row) return null;
    return {
      ...row,
      scenarioOutcomes: parseJsonSafe(row.scenario_outcomes_json, {}),
      metricsSnapshot: parseJsonSafe(row.metrics_snapshot_json, {})
    };
  }

  listBaselines(limit = 20) {
    return this.db
      .all('SELECT * FROM regression_baselines ORDER BY created_at DESC LIMIT ?', limit)
      .map((r) => ({
        ...r,
        scenarioOutcomes: parseJsonSafe(r.scenario_outcomes_json, {}),
        metricsSnapshot: parseJsonSafe(r.metrics_snapshot_json, {})
      }));
  }

  // 11. Cleanup Records
  insertCleanupRecord({
    cleanupId = generateId('cln'),
    observationId,
    executionId = null,
    scenarioId = null,
    status,
    plannedActions = [],
    completedActions = [],
    incompleteActions = [],
    notes = null,
    verifiedAt = null
  }) {
    const createdAt = new Date().toISOString();
    this.db.run(
      `INSERT INTO cleanup_records (
        cleanup_id, observation_id, execution_id, scenario_id, status,
        planned_actions_json, completed_actions_json, incomplete_actions_json,
        notes, created_at, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cleanupId,
      observationId,
      executionId,
      scenarioId,
      status,
      JSON.stringify(plannedActions),
      JSON.stringify(completedActions),
      JSON.stringify(incompleteActions),
      notes,
      createdAt,
      verifiedAt
    );
    return cleanupId;
  }

  listCleanupRecords({ observationId = null, limit = 50 } = {}) {
    const rows = observationId
      ? this.db.all(
          'SELECT * FROM cleanup_records WHERE observation_id = ? ORDER BY created_at DESC LIMIT ?',
          observationId,
          limit
        )
      : this.db.all('SELECT * FROM cleanup_records ORDER BY created_at DESC LIMIT ?', limit);
    return rows.map((r) => ({
      ...r,
      plannedActions: parseJsonSafe(r.planned_actions_json, []),
      completedActions: parseJsonSafe(r.completed_actions_json, []),
      incompleteActions: parseJsonSafe(r.incomplete_actions_json, [])
    }));
  }

  applyRetentionPolicy(retentionDays = 90) {
    return this.db.applyRetentionPolicy(retentionDays);
  }
}
