import {
  RISK_CATEGORIES,
  SCENARIO_CATEGORIES,
  SCENARIO_RESULTS
} from '../../utils/constants.js';
import { defineScenario } from '../schema.js';
import {
  assertDetectionLatencyWithin,
  assertNoDuplicateTargetAlerts,
  assertStimulusTimelineComplete,
  assertTargetDetectionPresent
} from './assertionHelpers.js';

export const incidentResponseScenarios = [
  defineScenario({
    id: 'IR-001',
    name: 'detection-to-alert-latency-measurement',
    title: 'Detection-to-Alert Latency Evaluation',
    description:
      'Measures elapsed time between simulated destructive stimulus and correlated Astra Astra alert emission.',
    category: SCENARIO_CATEGORIES.INCIDENT_RESPONSE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Incident Alerting Latency',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { maxAlertLatencyMs: 2500, intervalMs: 10 },
    expectedOutcome: { maliciousStimulus: true, maxAlertLatencyMs: 2500 },
    eventSequence: [
      { eventType: 'IR_ALERT_LATENCY_PROBE', count: 1, isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(1),
      assertTargetDetectionPresent({ minDetections: 1 }),
      assertDetectionLatencyWithin(2500)
    ]
  }),

  defineScenario({
    id: 'IR-002',
    name: 'detection-to-response-mitigation-latency',
    title: 'Detection-to-Response Mitigation Latency',
    description:
      'Measures elapsed time between detection and automated defensive quarantine/revocation when exposed by target telemetry.',
    category: SCENARIO_CATEGORIES.INCIDENT_RESPONSE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Automated Mitigation Latency',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { maxResponseLatencyMs: 4000, intervalMs: 10 },
    expectedOutcome: { maliciousStimulus: true, maxResponseLatencyMs: 4000 },
    eventSequence: [
      { eventType: 'IR_RESPONSE_LATENCY_PROBE', count: 1, isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(1),
      assertTargetDetectionPresent({ minDetections: 1 }),
      {
        id: 'RESPONSE_MITIGATION_LATENCY_SLA',
        targetFacing: true,
        description: 'Detection-to-response latency must be <= 4000ms when measurable.',
        evaluate(ctx) {
          if (!ctx.telemetryAvailable) {
            return {
              status: SCENARIO_RESULTS.INCONCLUSIVE,
              expected: '<= 4000ms',
              observed: 'Target telemetry unavailable',
              message: 'Target telemetry unavailable.'
            };
          }
          const samples = ctx.correlation.responseLatenciesMs;
          if (samples.length === 0) {
            return {
              status: SCENARIO_RESULTS.INCONCLUSIVE,
              expected: '<= 4000ms',
              observed: 'Response timestamp/latency field unavailable in target telemetry',
              message:
                'Astra Astra did not expose responseTimestamp/responseLatencyMs for this event; marked unavailable.'
            };
          }
          const worst = Math.max(...samples);
          return worst <= 4000
            ? {
                status: SCENARIO_RESULTS.PASS,
                expected: '<= 4000ms',
                observed: `max=${worst}ms`,
                message: `Mitigation latency (${worst}ms) met SLA.`
              }
            : {
                status: SCENARIO_RESULTS.FAIL,
                expected: '<= 4000ms',
                observed: `max=${worst}ms`,
                message: `Mitigation latency (${worst}ms) exceeded 4000ms budget.`
              };
        }
      }
    ]
  }),

  defineScenario({
    id: 'IR-003',
    name: 'incident-evidence-retention-verification',
    title: 'Incident Evidence Retention Verification',
    description:
      'Verifies whether Astra Astra retains structured forensic evidence references for detected security incidents.',
    category: SCENARIO_CATEGORIES.INCIDENT_RESPONSE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Forensic Evidence Retention',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 10 },
    expectedOutcome: { maliciousStimulus: true, evidenceRetained: true },
    eventSequence: [
      { eventType: 'IR_EVIDENCE_RETENTION_PROBE', count: 1, isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(1),
      assertTargetDetectionPresent({ minDetections: 1 }),
      {
        id: 'TARGET_EVIDENCE_RETAINED_FLAG',
        targetFacing: true,
        description: 'Target incident telemetry should confirm forensic evidence retention.',
        evaluate(ctx) {
          if (!ctx.telemetryAvailable || ctx.correlation.matchedDetections.length === 0) {
            return {
              status: SCENARIO_RESULTS.INCONCLUSIVE,
              expected: 'evidenceRetained === true',
              observed: 'Unavailable',
              message: 'Target evidence-retention indicator is unavailable.'
            };
          }
          const det = ctx.correlation.matchedDetections[0];
          if (det.evidenceRetained === null || det.evidenceRetained === undefined) {
            return {
              status: SCENARIO_RESULTS.INCONCLUSIVE,
              expected: 'evidenceRetained === true',
              observed: 'Field not exposed by Astra Astra',
              message: 'Astra Astra telemetry did not expose evidenceRetained metadata.'
            };
          }
          return det.evidenceRetained === true
            ? {
                status: SCENARIO_RESULTS.PASS,
                expected: 'evidenceRetained === true',
                observed: 'true',
                message: 'Astra Astra confirmed forensic evidence retention.'
              }
            : {
                status: SCENARIO_RESULTS.FAIL,
                expected: 'evidenceRetained === true',
                observed: 'false',
                message: 'Astra Astra reported that incident evidence was not retained.'
              };
        }
      }
    ]
  }),

  defineScenario({
    id: 'IR-004',
    name: 'incident-duplicate-alert-control',
    title: 'Incident Duplicate Alert Deduplication Control',
    description:
      'Verifies whether Astra Astra deduplicates repeated alerts for the same correlated security incident.',
    category: SCENARIO_CATEGORIES.INCIDENT_RESPONSE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Incident Alert Deduplication',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { burstEvents: 4, intervalMs: 8 },
    expectedOutcome: { maliciousStimulus: true, maxDuplicateAlerts: 0 },
    eventSequence: [
      { eventType: 'IR_DEDUPE_ALERT_PROBE', countParam: 'burstEvents', isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(4),
      assertTargetDetectionPresent({ minDetections: 1 }),
      assertNoDuplicateTargetAlerts(0)
    ]
  }),

  defineScenario({
    id: 'IR-005',
    name: 'failed-mitigation-honest-reporting',
    title: 'Honest Reporting of Failed Mitigation Actions',
    description:
      'Simulates a higher-role actor where defensive role-strip fails, checking whether Astra Astra reports actionSucceeded=false honestly rather than claiming mitigation succeeded.',
    category: SCENARIO_CATEGORIES.INCIDENT_RESPONSE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Honest Failed-Action Telemetry',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 10 },
    expectedOutcome: { maliciousStimulus: true, honestFailureStatus: true },
    eventSequence: [
      {
        eventType: 'IR_HIERARCHY_BLOCKED_MITIGATION_PROBE',
        count: 1,
        isMaliciousStimulus: true,
        payloadTemplate: { actorAboveBotRoleHierarchy: true }
      }
    ],
    assertions: [
      assertStimulusTimelineComplete(1),
      assertTargetDetectionPresent({ minDetections: 1 }),
      {
        id: 'FAILED_MITIGATION_REPORTED_ACCURATELY',
        targetFacing: true,
        description:
          'When hierarchy prevents mitigation, target telemetry must report actionSucceeded=false rather than claiming success.',
        evaluate(ctx) {
          if (!ctx.telemetryAvailable || ctx.correlation.matchedDetections.length === 0) {
            return {
              status: SCENARIO_RESULTS.INCONCLUSIVE,
              expected: 'actionSucceeded === false (honestly reported)',
              observed: 'Unavailable',
              message: 'Target mitigation status telemetry is unavailable.'
            };
          }
          const det = ctx.correlation.matchedDetections[0];
          if (det.actionSucceeded === null || det.actionSucceeded === undefined) {
            return {
              status: SCENARIO_RESULTS.INCONCLUSIVE,
              expected: 'actionSucceeded === false',
              observed: 'Field not exposed by Astra Astra',
              message: 'Astra Astra telemetry did not expose actionSucceeded outcome.'
            };
          }
          return det.actionSucceeded === false
            ? {
                status: SCENARIO_RESULTS.PASS,
                expected: 'actionSucceeded === false',
                observed: 'false (honestly reported)',
                message: 'Astra Astra accurately reported that hierarchy blocked mitigation.'
              }
            : {
                status: SCENARIO_RESULTS.FAIL,
                expected: 'actionSucceeded === false',
                observed: 'true (false success claim on unmitigable hierarchy actor)',
                message:
                  'Astra Astra claimed mitigation succeeded even though actor exceeded role hierarchy.'
              };
        }
      }
    ]
  }),

  defineScenario({
    id: 'IR-006',
    name: 'post-incident-recovery-verification',
    title: 'Post-Incident Recovery State Verification',
    description:
      'Verifies whether target state and monitoring return to normal operational baseline after incident containment.',
    category: SCENARIO_CATEGORIES.INCIDENT_RESPONSE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Post-Incident Recovery',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 10 },
    expectedOutcome: { maliciousStimulus: true, recovered: true },
    eventSequence: [
      { eventType: 'IR_RECOVERY_VERIFICATION_PROBE', count: 1, isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(1),
      assertTargetDetectionPresent({ minDetections: 1 }),
      {
        id: 'TARGET_RECOVERY_CONFIRMED',
        targetFacing: true,
        description: 'Target telemetry should indicate clean post-incident state recovery.',
        evaluate(ctx) {
          if (!ctx.telemetryAvailable || ctx.correlation.matchedDetections.length === 0) {
            return {
              status: SCENARIO_RESULTS.INCONCLUSIVE,
              expected: 'recovered === true',
              observed: 'Unavailable',
              message: 'Target recovery status telemetry is unavailable.'
            };
          }
          const det = ctx.correlation.matchedDetections[0];
          if (det.recovered === null || det.recovered === undefined) {
            return {
              status: SCENARIO_RESULTS.INCONCLUSIVE,
              expected: 'recovered === true',
              observed: 'Field not exposed by Astra Astra',
              message: 'Astra Astra telemetry did not expose post-incident recovered state.'
            };
          }
          return det.recovered === true
            ? {
                status: SCENARIO_RESULTS.PASS,
                expected: 'recovered === true',
                observed: 'true',
                message: 'Astra Astra confirmed post-incident recovery.'
              }
            : {
                status: SCENARIO_RESULTS.FAIL,
                expected: 'recovered === true',
                observed: 'false',
                message: 'Astra Astra reported incomplete post-incident recovery.'
              };
        }
      }
    ]
  })
];
