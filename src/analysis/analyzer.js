import { getScenarioById } from '../scenarios/catalog/index.js';
import {
  CONFIDENCE_LEVELS,
  EVIDENCE_SOURCES,
  FINDING_CLASSIFICATIONS,
  SCENARIO_CATEGORIES,
  SCENARIO_RESULTS,
  SEVERITY_LEVELS,
  TARGET_IDENTIFICATION_STATES
} from '../utils/constants.js';
import { generateId } from '../utils/ids.js';

function determineSeverityForFailedScenario(scenario) {
  if (!scenario) return SEVERITY_LEVELS.MEDIUM;
  if (
    ['ED-001', 'ED-002', 'ED-003', 'ED-004', 'ED-006'].includes(scenario.id)
  ) {
    return SEVERITY_LEVELS.CRITICAL;
  }
  if (
    scenario.category === SCENARIO_CATEGORIES.EVENT_DETECTION ||
    scenario.category === SCENARIO_CATEGORIES.INCIDENT_RESPONSE
  ) {
    return SEVERITY_LEVELS.HIGH;
  }
  if (scenario.category === SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE) {
    return SEVERITY_LEVELS.MEDIUM;
  }
  return SEVERITY_LEVELS.HIGH;
}

export class SecurityAnalyzer {
  constructor({ repositories, evidenceStore, logger = null }) {
    this.repositories = repositories;
    this.evidenceStore = evidenceStore;
    this.logger = logger;
  }

  /**
   * Analyzes completed scenario executions, environment limitations, and baseline deltas,
   * persisting evidence-backed findings and actionable remediation guidance.
   */
  analyzeObservation({
    observationId,
    executions = [],
    environment = {},
    metrics = {},
    activeBaseline = null
  }) {
    const findings = [];
    const recommendations = [];
    const regressedSet = new Set(
      (metrics.regressionsList || []).map((r) => r.scenarioId)
    );

    // 1. Evaluate scenario-level defects and suspected weaknesses
    for (const exec of executions) {
      const scenarioId = exec.scenarioId ?? exec.scenario_id;
      const scenario = getScenarioById(scenarioId);
      const finalResult = exec.finalResult ?? exec.final_result;

      if (finalResult === SCENARIO_RESULTS.FAIL) {
        const failedAssertions = (exec.assertions || []).filter(
          (a) => a.status === SCENARIO_RESULTS.FAIL
        );
        const observedSummary =
          failedAssertions.map((a) => `${a.id}: ${a.observed} (${a.message})`).join('; ') ||
          'Observed telemetry contradicted expected scenario behavior.';
        const expectedSummary =
          failedAssertions.map((a) => `${a.id}: ${a.expected}`).join('; ') ||
          'All scenario assertions satisfied.';

        const severity = determineSeverityForFailedScenario(scenario);
        const isRegressed = regressedSet.has(scenarioId);
        const findingId = generateId('fnd');

        const evidenceRefs = exec.evidenceReferences || [];
        const recommendationDetail = this.buildScenarioRecommendation({
          scenario,
          scenarioId,
          failedAssertions,
          evidenceRefs
        });

        const finding = {
          findingId,
          observationId,
          executionId: exec.executionId ?? exec.execution_id,
          scenarioId,
          classification: FINDING_CLASSIFICATIONS.CONFIRMED_DEFECT,
          title: `Confirmed Defensive Defect in ${scenario?.title || scenarioId}`,
          severity,
          confidence: CONFIDENCE_LEVELS.HIGH,
          affectedCapability: scenario?.affectedCapability || exec.category || 'Defensive Engine',
          evidenceReferences: evidenceRefs,
          expectedBehavior: expectedSummary,
          observedBehavior: observedSummary,
          potentialImpact: this.describeImpact(scenario),
          reproductionProcedure: `Run /lab-replay with execution_id=${
            exec.executionId ?? exec.execution_id
          } (scenario ${scenarioId}@${exec.scenarioVersion ?? exec.scenario_version}) while Astra Astra telemetry adapter is active.`,
          recommendedFix: recommendationDetail.whatShouldChange,
          regressionTest: `${scenarioId}@${exec.scenarioVersion ?? exec.scenario_version}`,
          verificationStatus: isRegressed ? 'REGRESSED' : 'OPEN',
          recommendationDetail
        };

        this.repositories.insertFinding(finding);
        findings.push(finding);
        recommendations.push({
          findingId,
          scenarioId,
          severity,
          ...recommendationDetail
        });
      } else if (finalResult === SCENARIO_RESULTS.PARTIAL) {
        const unresolvedAssertions = (exec.assertions || []).filter(
          (a) => a.status !== SCENARIO_RESULTS.PASS
        );
        const findingId = generateId('fnd');
        const evidenceRefs = exec.evidenceReferences || [];

        const recommendationDetail = {
          whatShouldChange: `Expose structured incident telemetry fields (${unresolvedAssertions
            .map((a) => a.id)
            .join(', ')}) in Astra Astra logs/webhooks for ${scenarioId}.`,
          whyItMatters:
            'Primary event detection succeeded, but secondary mitigation latency, forensic retention, or recovery verification remained unconfirmed.',
          supportingEvidence: evidenceRefs,
          howToImplement:
            'Emit structured JSON fields (responseTimestampMs, actionSucceeded, evidenceRetained, recovered) alongside detection alerts in Astra Astra telemetry.',
          howToVerify: `Rerun scenario ${scenarioId} via /lab-replay or /observe and confirm assertion status transitions from PARTIAL to PASS.`,
          potentialRegressionRisk:
            'Low risk: ensure asynchronous telemetry serialization does not block Astra Astra event-loop mitigation.',
          rerunScenarios: [scenarioId]
        };

        const finding = {
          findingId,
          observationId,
          executionId: exec.executionId ?? exec.execution_id,
          scenarioId,
          classification: FINDING_CLASSIFICATIONS.SUSPECTED_WEAKNESS,
          title: `Partial Telemetry / Unverified Secondary Assertion in ${
            scenario?.title || scenarioId
          }`,
          severity: SEVERITY_LEVELS.LOW,
          confidence: CONFIDENCE_LEVELS.MEDIUM,
          affectedCapability: scenario?.affectedCapability || 'Incident Telemetry Visibility',
          evidenceReferences: evidenceRefs,
          expectedBehavior: 'All primary detection and secondary response assertions verified.',
          observedBehavior: unresolvedAssertions
            .map((a) => `${a.id}: ${a.observed}`)
            .join('; '),
          potentialImpact:
            'Operators cannot independently verify automated mitigation speed or post-incident state recovery.',
          reproductionProcedure: `Replay execution ${
            exec.executionId ?? exec.execution_id
          } via /lab-replay and inspect unresolved assertion fields.`,
          recommendedFix: recommendationDetail.whatShouldChange,
          regressionTest: `${scenarioId}@${exec.scenarioVersion ?? exec.scenario_version}`,
          verificationStatus: 'PENDING_TELEMETRY',
          recommendationDetail
        };

        this.repositories.insertFinding(finding);
        findings.push(finding);
        recommendations.push({
          findingId,
          scenarioId,
          severity: SEVERITY_LEVELS.LOW,
          ...recommendationDetail
        });
      }
    }

    // 2. Record informational observations for target ambiguity, unverified integration, or blocked permissions
    const targetDiscovery = environment.targetDiscovery || {};
    if (targetDiscovery.state === TARGET_IDENTIFICATION_STATES.AMBIGUOUS) {
      const inferenceEv = this.evidenceStore.recordEvidence({
        observationId,
        scenarioId: 'ENV-TARGET-ID',
        sourceType: EVIDENCE_SOURCES.ANALYST_INFERENCE,
        summary: `Ambiguous target bot identity (${
          targetDiscovery.candidateBots?.length || 0
        } candidate bots found)`,
        relationshipExplanation:
          'Multiple bot accounts exist in the inspected guild while ASTRA_ASTRA_BOT_ID is unset; platform refused to guess Astra Astra identity.',
        metadata: {
          candidateBots: targetDiscovery.candidateBots || []
        }
      });

      const findingId = generateId('fnd');
      const recDetail = {
        whatShouldChange:
          'Configure ASTRA_ASTRA_BOT_ID in .env with Astra Astra’s exact numeric Discord application/bot user ID.',
        whyItMatters:
          'When multiple bots inhabit a server, guessing target identity could misattribute another bot’s actions to Astra Astra.',
        supportingEvidence: [
          {
            evidenceId: inferenceEv.evidenceId,
            sourceType: inferenceEv.sourceType,
            role: 'TARGET_AMBIGUITY'
          }
        ],
        howToImplement:
          'Set ASTRA_ASTRA_BOT_ID=<17-20 digit snowflake> in .env and run /config-validate.',
        howToVerify:
          'Execute /observe and confirm Target Identification State transitions from AMBIGUOUS to VERIFIED.',
        potentialRegressionRisk:
          'An incorrect snowflake ID will cause target state to report CONFIGURED_NOT_PRESENT.',
        rerunScenarios: ['ED-001', 'FPR-001']
      };

      const infoFinding = {
        findingId,
        observationId,
        executionId: null,
        scenarioId: 'ENV-TARGET-ID',
        classification: FINDING_CLASSIFICATIONS.INFORMATIONAL_OBSERVATION,
        title: 'Ambiguous Target Bot Identity — Operator Clarification Required',
        severity: SEVERITY_LEVELS.INFO,
        confidence: CONFIDENCE_LEVELS.HIGH,
        affectedCapability: 'Target Bot Identification',
        evidenceReferences: recDetail.supportingEvidence,
        expectedBehavior: 'Single unambiguous verified Astra Astra bot identity.',
        observedBehavior: targetDiscovery.explanation,
        potentialImpact:
          'Target-specific controlled approval and live attribution remain disabled until Astra Astra’s numeric ID is verified.',
        reproductionProcedure: 'Run /observe in a multi-bot guild with ASTRA_ASTRA_BOT_ID unset.',
        recommendedFix: recDetail.whatShouldChange,
        regressionTest: 'ENV-TARGET-ID',
        verificationStatus: 'OPEN',
        recommendationDetail: recDetail
      };

      this.repositories.insertFinding(infoFinding);
      findings.push(infoFinding);
      recommendations.push({
        findingId,
        scenarioId: 'ENV-TARGET-ID',
        severity: SEVERITY_LEVELS.INFO,
        ...recDetail
      });
    } else if (!environment.telemetry?.available) {
      const inferenceEv = this.evidenceStore.recordEvidence({
        observationId,
        scenarioId: 'ENV-TELEMETRY',
        sourceType: EVIDENCE_SOURCES.ANALYST_INFERENCE,
        summary: 'Astra Astra external telemetry adapter not connected during observation',
        relationshipExplanation:
          'Target-evaluating scenarios ran in non-destructive simulation mode and were classified INCONCLUSIVE rather than fabricated PASS/FAIL.',
        metadata: {
          targetState: targetDiscovery.state || 'UNCONFIGURED'
        }
      });

      const findingId = generateId('fnd');
      const recDetail = {
        whatShouldChange:
          'Connect at least one Astra Astra telemetry source (structured JSON logs, incident export, detection history, or HMAC-authenticated telemetry webhook).',
        whyItMatters:
          'Without Astra Astra telemetry, simulated attack stimuli cannot be correlated against Astra Astra internal detections, leaving target assertions INCONCLUSIVE.',
        supportingEvidence: [
          {
            evidenceId: inferenceEv.evidenceId,
            sourceType: inferenceEv.sourceType,
            role: 'TELEMETRY_GAP'
          }
        ],
        howToImplement:
          'Configure ASTRA_ASTRA_LOG_PATH or ENABLE_TELEMETRY_WEBHOOK=true with TELEMETRY_WEBHOOK_SECRET in .env (see docs/ASTRA_ASTRA_INTEGRATION.md).',
        howToVerify:
          'Run /observe and confirm target scenarios transition from INCONCLUSIVE to evidence-backed PASS or FAIL.',
        potentialRegressionRisk:
          'Ensure log file permissions remain restricted to the service account and webhook secrets are >=16 bytes.',
        rerunScenarios: ['ED-001', 'ED-004', 'FPR-001', 'IR-001']
      };

      const infoFinding = {
        findingId,
        observationId,
        executionId: null,
        scenarioId: 'ENV-TELEMETRY',
        classification: FINDING_CLASSIFICATIONS.INFORMATIONAL_OBSERVATION,
        title: 'Astra Astra Telemetry Unavailable — Target Scenarios Marked INCONCLUSIVE',
        severity: SEVERITY_LEVELS.INFO,
        confidence: CONFIDENCE_LEVELS.HIGH,
        affectedCapability: 'Astra Astra Telemetry Correlation',
        evidenceReferences: recDetail.supportingEvidence,
        expectedBehavior:
          'Authenticated telemetry or structured logs exposed for simulated-to-target correlation.',
        observedBehavior:
          'Zero external Astra Astra telemetry sources were active during this run.',
        potentialImpact:
          'Astra Astra detection recall, precision, and false-positive rates cannot be measured until telemetry is provided.',
        reproductionProcedure: 'Run /observe without ASTRA_ASTRA_LOG_PATH or webhook events.',
        recommendedFix: recDetail.whatShouldChange,
        regressionTest: 'ENV-TELEMETRY',
        verificationStatus: 'PENDING_TELEMETRY',
        recommendationDetail: recDetail
      };

      this.repositories.insertFinding(infoFinding);
      findings.push(infoFinding);
      recommendations.push({
        findingId,
        scenarioId: 'ENV-TELEMETRY',
        severity: SEVERITY_LEVELS.INFO,
        ...recDetail
      });
    }

    // Update active baseline automatically when we have conclusive outcomes and no baseline existed yet
    let updatedBaselineId = activeBaseline?.baseline_id || null;
    if (!activeBaseline) {
      const conclusiveMap = {};
      for (const exec of executions) {
        const res = exec.finalResult ?? exec.final_result;
        const sId = exec.scenarioId ?? exec.scenario_id;
        if (['PASS', 'FAIL', 'PARTIAL'].includes(res)) {
          conclusiveMap[sId] = res;
        }
      }
      if (Object.keys(conclusiveMap).length > 0) {
        updatedBaselineId = this.repositories.saveRegressionBaseline({
          observationId,
          guildId: environment.guildId || null,
          targetBotId: targetDiscovery.botId || null,
          targetVersion: targetDiscovery.version || null,
          scenarioOutcomes: conclusiveMap,
          metricsSnapshot: metrics
        });
      }
    }

    return {
      findings,
      recommendations,
      baselineId: updatedBaselineId
    };
  }

  describeImpact(scenario) {
    if (!scenario) {
      return 'Potential defensive gap under adversarial server activity.';
    }
    if (scenario.category === SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE) {
      return 'Legitimate administrators or routine maintenance workflows may be falsely quarantined, disrupting server operations.';
    }
    if (scenario.category === SCENARIO_CATEGORIES.INCIDENT_RESPONSE) {
      return 'Delayed alerting, duplicate alert fatigue, or silent mitigation failures can extend attacker dwell time during an active raid.';
    }
    return `Adversarial ${scenario.title.toLowerCase()} could bypass automated detection or containment in Astra Astra.`;
  }

  buildScenarioRecommendation({ scenario, scenarioId, failedAssertions, evidenceRefs }) {
    if (scenario?.category === SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE) {
      return {
        whatShouldChange: `Refine ${scenario.affectedCapability} thresholds and allowlist/permission-diff checks in Astra Astra so ${scenario.name} does not trigger defensive alerts.`,
        whyItMatters:
          'False positives erode operator trust and risk stripping roles from authorized moderators during legitimate server administration.',
        supportingEvidence: evidenceRefs,
        howToImplement:
          'Verify audit-log executor allowlist status and check whether dangerous permission bits actually changed before incrementing anti-nuke counters.',
        howToVerify: `Rerun ${scenarioId} via /lab-replay and confirm 0 correlated alerts are emitted.`,
        potentialRegressionRisk:
          'Overly broad allowlisting could blind detection if an allowlisted administrator account is compromised; enforce rate caps even for trusted roles.',
        rerunScenarios: [scenarioId, 'ED-003', 'ED-001']
      };
    }

    if (scenario?.category === SCENARIO_CATEGORIES.INCIDENT_RESPONSE) {
      return {
        whatShouldChange: `Optimize Astra Astra incident pipeline for ${scenario.affectedCapability} (${failedAssertions
          .map((a) => a.id)
          .join(', ')}).`,
        whyItMatters:
          'Fast, deduplicated, and honest incident reporting is essential to contain high-velocity anti-nuke events.',
        supportingEvidence: evidenceRefs,
        howToImplement:
          'Deduplicate incident alerts by `(guildId, actorId, incidentWindowId)`, prioritize mitigation REST calls ahead of verbose logging, and record explicit `actionSucceeded=false` when Discord returns HTTP 403 Missing Permissions.',
        howToVerify: `Execute /lab-replay for ${scenarioId} and verify assertion compliance.`,
        potentialRegressionRisk:
          'Aggressive alert deduplication windows could suppress distinct follow-up attacks if keyed only by guildId rather than actorId + vector.',
        rerunScenarios: [scenarioId, 'TC-008']
      };
    }

    return {
      whatShouldChange: `Strengthen Astra Astra ${
        scenario?.affectedCapability || 'event detection'
      } correlation rules to detect ${scenario?.title || scenarioId}.`,
      whyItMatters: `Active telemetry confirmed simulated stimulus (${scenarioId}) was not detected within the expected correlation window.`,
      supportingEvidence: evidenceRefs,
      howToImplement:
        'Track per-actor sliding-window counters across both Gateway events and asynchronous Guild Audit Log entries, correlating out-of-order and spaced bursts.',
      howToVerify: `Import updated Astra Astra telemetry or connect webhook and rerun ${scenarioId} + regression suite via /observe.`,
      potentialRegressionRisk:
        'Lowering burst thresholds too aggressively can introduce false positives on routine maintenance; always rerun FPR-001..FPR-006 alongside the fix.',
      rerunScenarios: [scenarioId, 'FPR-001', 'FPR-006']
    };
  }

  /**
   * Compares two persisted observation runs for /observe-compare and /security-regressions.
   */
  compareRuns(olderObsId, newerObsId) {
    const olderRun = this.repositories.getObservationRun(olderObsId);
    const newerRun = this.repositories.getObservationRun(newerObsId);
    if (!olderRun || !newerRun) {
      throw new Error('Both observation IDs must exist in SQLite to compare runs.');
    }

    const olderExecs = this.repositories.listScenarioExecutionsByObservation(olderObsId);
    const newerExecs = this.repositories.listScenarioExecutionsByObservation(newerObsId);

    const olderMap = new Map(olderExecs.map((e) => [e.scenario_id, e.final_result]));
    const newerMap = new Map(newerExecs.map((e) => [e.scenario_id, e.final_result]));

    const allScenarioIds = Array.from(
      new Set([...olderMap.keys(), ...newerMap.keys()])
    ).sort();

    const regressions = [];
    const improvements = [];
    const unchanged = [];
    const incomparable = [];

    for (const scenarioId of allScenarioIds) {
      const before = olderMap.get(scenarioId) || 'NOT_RUN';
      const after = newerMap.get(scenarioId) || 'NOT_RUN';

      if (before === after) {
        unchanged.push({ scenarioId, result: after });
      } else if (before === 'PASS' && ['FAIL', 'PARTIAL'].includes(after)) {
        regressions.push({ scenarioId, before, after });
      } else if (['FAIL', 'PARTIAL'].includes(before) && after === 'PASS') {
        improvements.push({ scenarioId, before, after });
      } else {
        incomparable.push({ scenarioId, before, after });
      }
    }

    return {
      olderObservationId: olderObsId,
      newerObservationId: newerObsId,
      olderStatus: olderRun.overall_status,
      newerStatus: newerRun.overall_status,
      regressions,
      improvements,
      unchangedCount: unchanged.length,
      incomparable,
      olderMetrics: olderRun.metrics,
      newerMetrics: newerRun.metrics
    };
  }
}
