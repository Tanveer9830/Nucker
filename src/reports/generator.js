import { CREATOR_ATTRIBUTION } from '../utils/constants.js';
import { redactSecrets } from '../utils/redaction.js';

function formatRatioMetric(metricObj) {
  if (!metricObj || !metricObj.available) {
    return `UNAVAILABLE (${metricObj?.missingReason || 'Insufficient evidence'})`;
  }
  return `${metricObj.percentage}% (${metricObj.numerator}/${metricObj.denominator})`;
}

function formatLatencyMetric(latObj) {
  if (!latObj || !latObj.available) {
    return `UNAVAILABLE (n=0, missing=${latObj?.missingCount ?? 0})`;
  }
  const p95Part = latObj.insufficientSampleForP95
    ? `p95=N/A (requires n>=${latObj.p95MinimumSampleSize}, actual n=${latObj.sampleSize})`
    : `p95=${latObj.p95Ms}ms`;
  return `median=${latObj.medianMs}ms, ${p95Part}, min=${latObj.minMs}ms, max=${latObj.maxMs}ms (n=${latObj.sampleSize}, missing=${latObj.missingCount})`;
}

export class ReportGenerator {
  constructor({ repositories, explicitSecrets = [] }) {
    this.repositories = repositories;
    this.explicitSecrets = explicitSecrets;
  }

  /**
   * Deterministic report generation strictly from persisted SQLite records (Part 13).
   * Never requires rerunning scenarios.
   */
  generateFromDatabase(observationId) {
    const run = this.repositories.getObservationRun(observationId);
    if (!run) {
      throw new Error(`Cannot generate report: observation "${observationId}" does not exist.`);
    }

    const executions = this.repositories.listScenarioExecutionsByObservation(observationId);
    const findings = this.repositories.listFindingsByObservation(observationId);
    const evidence = this.repositories.listEvidenceByObservation(observationId);
    const cleanups = this.repositories.listCleanupRecords({ observationId, limit: 200 });

    const metrics = run.metrics || {};
    const counts = metrics.counts || {
      selected: executions.filter((e) => e.final_result !== 'BLOCKED').length,
      passed: executions.filter((e) => e.final_result === 'PASS').length,
      failed: executions.filter((e) => e.final_result === 'FAIL').length,
      partial: executions.filter((e) => e.final_result === 'PARTIAL').length,
      blocked: executions.filter((e) => e.final_result === 'BLOCKED').length,
      inconclusive: executions.filter((e) => e.final_result === 'INCONCLUSIVE').length,
      cancelled: executions.filter((e) => e.final_result === 'CANCELLED').length
    };

    const verifiedTargetBotId =
      run.target_identification_state === 'VERIFIED' ||
      run.target_identification_state === 'TELEMETRY_ONLY'
        ? run.target_bot_id
        : null;

    const evidenceBySource = {};
    for (const ev of evidence) {
      evidenceBySource[ev.source_type] = (evidenceBySource[ev.source_type] || 0) + 1;
    }

    const structuredReport = redactSecrets(
      {
        header: 'TANVEER KA BETA NEWKER — SECURITY OBSERVATION REPORT',
        creatorAttribution: CREATOR_ATTRIBUTION,
        observationId: run.observation_id,
        serverName: run.guild_name || 'Standalone / Non-Guild Context',
        guildId: run.guild_id || 'N/A',
        targetBotName: run.target_bot_name || 'Astra Astra',
        targetBotId: verifiedTargetBotId || `UNVERIFIED (${run.target_identification_state})`,
        targetIdentificationState: run.target_identification_state,
        observationStartTime: run.started_at,
        observationCompletionTime: run.completed_at || 'INCOMPLETE',
        overallStatus: run.overall_status,
        integrationStatus: run.integration_status,
        scenarioCounts: {
          selected: counts.selected,
          passed: counts.passed,
          failed: counts.failed,
          partial: counts.partial ?? 0,
          blocked: counts.blocked,
          inconclusive: counts.inconclusive,
          cancelled: counts.cancelled ?? 0
        },
        detectionMetrics: {
          scenarioPassRate: formatRatioMetric(metrics.scenarioPassRate),
          scenarioFailureRate: formatRatioMetric(metrics.scenarioFailureRate),
          detectionRate: formatRatioMetric(metrics.detectionRate),
          missedDetectionRate: formatRatioMetric(metrics.missedDetectionRate),
          falsePositiveRate: formatRatioMetric(metrics.falsePositiveRate),
          precision: formatRatioMetric(metrics.precision),
          recall: formatRatioMetric(metrics.recall),
          detectionLatency: formatLatencyMetric(metrics.detectionLatency),
          responseLatency: formatLatencyMetric(metrics.responseLatency),
          eventCollectionCompleteness: formatRatioMetric(metrics.eventCollectionCompleteness),
          duplicateAlertRate: formatRatioMetric(metrics.duplicateAlertRate),
          recoveryTime: formatLatencyMetric(metrics.recoveryTime),
          regressionRate: formatRatioMetric(metrics.regressionRate)
        },
        evidenceSourceBreakdown: evidenceBySource,
        findings: findings.map((f) => ({
          findingId: f.findingId,
          classification: f.classification,
          severity: f.severity,
          confidence: f.confidence,
          scenarioId: f.scenarioId,
          title: f.title,
          affectedCapability: f.affectedCapability,
          observedBehavior: f.observedBehavior,
          recommendedFix: f.recommendedFix,
          verificationStatus: f.verificationStatus,
          evidenceReferences: f.evidenceReferences
        })),
        criticalLimitations: run.limitations || [],
        recommendedFixes: findings.map((f) => ({
          findingId: f.findingId,
          scenarioId: f.scenarioId,
          whatShouldChange: f.recommendationDetail?.whatShouldChange || f.recommendedFix,
          whyItMatters: f.recommendationDetail?.whyItMatters || f.potentialImpact,
          howToVerify: f.recommendationDetail?.howToVerify || `Rerun ${f.regressionTest}`,
          rerunScenarios: f.recommendationDetail?.rerunScenarios || [f.scenarioId]
        })),
        controlledTestApproval: {
          assessmentState: run.assessment_state,
          eligible: run.assessment_state === 'READY_FOR_APPROVAL',
          summary: run.approvalSummary?.summaryWhatItWillDo || 'Not eligible for approval.',
          failedSafeguards: run.approvalSummary?.failedSafeguards || [],
          reasons: run.approvalSummary?.reasons || []
        },
        cleanupSummary: {
          totalRecords: cleanups.length,
          incompleteRecords: cleanups.filter((c) => c.incompleteActions.length > 0).length
        }
      },
      this.explicitSecrets
    );

    const renderedMarkdown = this.renderMarkdownReport(structuredReport);
    return {
      structuredReport,
      renderedMarkdown
    };
  }

  renderMarkdownReport(r) {
    const lines = [];
    lines.push(`# ${r.header}`);
    lines.push(`> **Creator:** ${r.creatorAttribution}`);
    lines.push('');
    lines.push('## 1. Observation Metadata');
    lines.push(`- **Observation ID:** \`${r.observationId}\``);
    lines.push(`- **Server Name:** ${r.serverName}`);
    lines.push(`- **Guild ID:** \`${r.guildId}\``);
    lines.push(`- **Target Bot Name:** ${r.targetBotName}`);
    lines.push(`- **Target Bot ID:** \`${r.targetBotId}\``);
    lines.push(`- **Observation Start Time:** ${r.observationStartTime}`);
    lines.push(`- **Observation Completion Time:** ${r.observationCompletionTime}`);
    lines.push(`- **Overall Status:** \`${r.overallStatus}\``);
    lines.push(`- **Integration Status:** \`${r.integrationStatus}\``);
    lines.push('');
    lines.push('## 2. Scenario Execution Summary');
    lines.push(`- **Scenarios Selected:** ${r.scenarioCounts.selected}`);
    lines.push(`- **Scenarios Passed:** ${r.scenarioCounts.passed}`);
    lines.push(`- **Scenarios Failed:** ${r.scenarioCounts.failed}`);
    lines.push(`- **Scenarios Partial:** ${r.scenarioCounts.partial}`);
    lines.push(`- **Scenarios Blocked:** ${r.scenarioCounts.blocked}`);
    lines.push(`- **Scenarios Inconclusive:** ${r.scenarioCounts.inconclusive}`);
    if (r.scenarioCounts.cancelled > 0) {
      lines.push(`- **Scenarios Cancelled:** ${r.scenarioCounts.cancelled}`);
    }
    lines.push('');
    lines.push('## 3. Detection & Performance Metrics');
    lines.push(`- **Scenario Pass Rate:** ${r.detectionMetrics.scenarioPassRate}`);
    lines.push(`- **Scenario Failure Rate:** ${r.detectionMetrics.scenarioFailureRate}`);
    lines.push(`- **Detection Rate (Recall):** ${r.detectionMetrics.detectionRate}`);
    lines.push(`- **Missed-Detection Rate:** ${r.detectionMetrics.missedDetectionRate}`);
    lines.push(`- **False-Positive Rate:** ${r.detectionMetrics.falsePositiveRate}`);
    lines.push(`- **Precision:** ${r.detectionMetrics.precision}`);
    lines.push(`- **Recall:** ${r.detectionMetrics.recall}`);
    lines.push(`- **Detection Latency:** ${r.detectionMetrics.detectionLatency}`);
    lines.push(`- **Response Latency:** ${r.detectionMetrics.responseLatency}`);
    lines.push(
      `- **Event Collection Completeness:** ${r.detectionMetrics.eventCollectionCompleteness}`
    );
    lines.push(`- **Duplicate-Alert Rate:** ${r.detectionMetrics.duplicateAlertRate}`);
    lines.push(`- **Recovery Time:** ${r.detectionMetrics.recoveryTime}`);
    lines.push(`- **Regression Rate:** ${r.detectionMetrics.regressionRate}`);
    lines.push('');
    lines.push('## 4. Evidence Source Breakdown');
    const sourceEntries = Object.entries(r.evidenceSourceBreakdown);
    if (sourceEntries.length === 0) {
      lines.push('- None recorded.');
    } else {
      for (const [src, cnt] of sourceEntries) {
        lines.push(`- **${src}:** ${cnt} record(s)`);
      }
    }
    lines.push('');
    lines.push('## 5. Evidence-Backed Findings');
    if (r.findings.length === 0) {
      lines.push('- No confirmed defects or weaknesses identified in evaluated evidence.');
    } else {
      for (const f of r.findings) {
        const evIds = (f.evidenceReferences || []).map((e) => e.evidenceId).join(', ') || 'None';
        lines.push(
          `- **[${f.severity} | ${f.classification}] ${f.findingId} — ${f.title}** (\`${f.scenarioId}\`)`
        );
        lines.push(`  - Observed: ${f.observedBehavior}`);
        lines.push(`  - Evidence IDs: \`${evIds}\``);
      }
    }
    lines.push('');
    lines.push('## 6. Critical Limitations');
    if (r.criticalLimitations.length === 0) {
      lines.push('- None reported.');
    } else {
      for (const lim of r.criticalLimitations) {
        lines.push(`- ${lim}`);
      }
    }
    lines.push('');
    lines.push('## 7. Recommended Fixes');
    if (r.recommendedFixes.length === 0) {
      lines.push('- No immediate remediation actions required.');
    } else {
      for (const rec of r.recommendedFixes) {
        lines.push(`- **${rec.findingId} (\`${rec.scenarioId}\`):** ${rec.whatShouldChange}`);
        lines.push(`  - Verification: ${rec.howToVerify}`);
      }
    }
    lines.push('');
    lines.push('## 8. Controlled Test Approval Eligibility');
    lines.push(`- **Assessment State:** \`${r.controlledTestApproval.assessmentState}\``);
    lines.push(`- **Eligible for Separate Controlled Test Approval:** ${r.controlledTestApproval.eligible ? 'YES' : 'NO'}`);
    lines.push(`- **Summary:** ${r.controlledTestApproval.summary}`);
    if (!r.controlledTestApproval.eligible && r.controlledTestApproval.reasons.length > 0) {
      for (const reason of r.controlledTestApproval.reasons) {
        lines.push(`  - Safeguard Block: ${reason}`);
      }
    }
    lines.push('');
    lines.push(`---`);
    lines.push(`${r.creatorAttribution}`);

    return lines.join('\n');
  }

  /**
   * Generates a structured Part-9 Workflow Failure Report when an unexpected error aborts /observe.
   */
  renderWorkflowFailureMarkdown({
    observationId,
    failedStage,
    errorCategory,
    lastSuccessfulStage,
    databaseSaved,
    reportSaved,
    recommendedRecoveryAction
  }) {
    return [
      '# TANVEER KA BETA NEWKER — OBSERVATION WORKFLOW FAILURE NOTICE',
      `> **Creator:** ${CREATOR_ATTRIBUTION}`,
      '',
      `- **Observation ID:** \`${observationId || 'UNASSIGNED'}\``,
      `- **Failed Stage:** \`${failedStage}\``,
      `- **Actual Error Category:** \`${errorCategory}\``,
      `- **Last Successful Stage:** \`${lastSuccessfulStage || 'NONE'}\``,
      `- **Database State Saved:** ${databaseSaved ? 'YES' : 'NO'}`,
      `- **Failure Report Saved:** ${reportSaved ? 'YES' : 'NO'}`,
      `- **Recommended Recovery Action:** ${recommendedRecoveryAction}`,
      '',
      '---',
      CREATOR_ATTRIBUTION
    ].join('\n');
  }
}
