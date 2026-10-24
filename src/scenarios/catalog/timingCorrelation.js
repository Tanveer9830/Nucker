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

export const timingCorrelationScenarios = [
  defineScenario({
    id: 'TC-001',
    name: 'rapid-event-burst-correlation',
    title: 'Rapid High-Frequency Event Bursts',
    description:
      'Emits a compact burst of suspicious events separated by sub-10ms intervals to evaluate sliding-window burst correlation.',
    category: SCENARIO_CATEGORIES.TIMING_CORRELATION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Sliding-Window Burst Correlation',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { burstSize: 6, intervalMs: 5 },
    expectedOutcome: { maliciousStimulus: true, expectedTargetDetection: true },
    eventSequence: [
      { eventType: 'CHANNEL_DELETE_BURST', countParam: 'burstSize', isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(6),
      assertTargetDetectionPresent({ minDetections: 1 })
    ]
  }),

  defineScenario({
    id: 'TC-002',
    name: 'duplicate-gateway-event-handling',
    title: 'Duplicate Event Delivery Handling',
    description:
      'Re-delivers identical external event IDs to verify collector deduplication and prevent inflated burst counters.',
    category: SCENARIO_CATEGORIES.TIMING_CORRELATION,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'Duplicate Event Deduplication',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { duplicateRepeats: 3, intervalMs: 5 },
    expectedOutcome: { maliciousStimulus: false, deduplicatedCorrectly: true },
    eventSequence: [
      {
        eventType: 'ROLE_UPDATE_DUPLICATE_PROBE',
        countParam: 'duplicateRepeats',
        fixedExternalId: 'dup_gateway_probe_001',
        isMaliciousStimulus: false
      }
    ],
    assertions: [
      assertStimulusTimelineComplete(3),
      {
        id: 'COLLECTOR_MARKED_DUPLICATES',
        targetFacing: false,
        description: 'Subsequent deliveries of the same externalEventId must be marked isDuplicate=true.',
        evaluate(ctx) {
          const dupes = ctx.stimulusEvents.filter((e) => e.isDuplicate).length;
          if (dupes === ctx.stimulusEvents.length - 1 && dupes >= 1) {
            return {
              status: SCENARIO_RESULTS.PASS,
              expected: `${ctx.stimulusEvents.length - 1} duplicate flag(s)`,
              observed: `${dupes} duplicate flag(s)`,
              message: 'Duplicate gateway deliveries were accurately identified and flagged.'
            };
          }
          return {
            status: SCENARIO_RESULTS.FAIL,
            expected: `${ctx.stimulusEvents.length - 1} duplicate flag(s)`,
            observed: `${dupes} duplicate flag(s)`,
            message: 'Duplicate event detector did not mark repeated deliveries accurately.'
          };
        }
      }
    ]
  }),

  defineScenario({
    id: 'TC-003',
    name: 'out-of-order-event-arrival',
    title: 'Out-of-Order Event Sequence Correlation',
    description:
      'Delivers events with non-monotonic timestamps (t+200ms arriving before t+0ms) to verify timestamp-ordered correlation.',
    category: SCENARIO_CATEGORIES.TIMING_CORRELATION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Out-of-Order Event Ordering',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { timestampOffsetsMs: [200, 0, 100], intervalMs: 5 },
    expectedOutcome: { maliciousStimulus: true, expectedTargetDetection: true },
    eventSequence: [
      {
        eventType: 'OUT_OF_ORDER_ROLE_DELETE',
        count: 3,
        timestampOffsetsParam: 'timestampOffsetsMs',
        isMaliciousStimulus: true
      }
    ],
    assertions: [
      assertStimulusTimelineComplete(3),
      assertTargetDetectionPresent({
        minDetections: 1,
        description: 'Target correlation should succeed even when events arrive out of timestamp order.'
      })
    ]
  }),

  defineScenario({
    id: 'TC-004',
    name: 'missing-intermediate-events',
    title: 'Missing Intermediate Events Resilience',
    description:
      'Simulates dropped intermediate gateway events while audit/terminal indicators remain present.',
    category: SCENARIO_CATEGORIES.TIMING_CORRELATION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Partial Event Stream Correlation',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { emittedEvents: 2, droppedSimulatedCount: 2, intervalMs: 10 },
    expectedOutcome: { maliciousStimulus: true, expectedTargetDetection: true },
    eventSequence: [
      {
        eventType: 'PARTIAL_STREAM_BAN_INDICATOR',
        countParam: 'emittedEvents',
        isMaliciousStimulus: true,
        payloadTemplate: { droppedPriorGatewayFrames: 2 }
      }
    ],
    assertions: [
      assertStimulusTimelineComplete(2),
      assertTargetDetectionPresent({ minDetections: 1 })
    ]
  }),

  defineScenario({
    id: 'TC-005',
    name: 'delayed-audit-log-availability',
    title: 'Delayed Audit-Log Availability',
    description:
      'Simulates gateway deletion arriving immediately while the corresponding Discord Audit Log entry arrives after a configurable delay.',
    category: SCENARIO_CATEGORIES.TIMING_CORRELATION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Asynchronous Audit-Log Attribution',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: ['ViewAuditLog'] },
    parameters: { auditLogDelayMs: 40, intervalMs: 10 },
    expectedOutcome: { maliciousStimulus: true, expectedTargetDetection: true },
    eventSequence: [
      { eventType: 'GATEWAY_CHANNEL_DELETE', count: 1, isMaliciousStimulus: true },
      { eventType: 'DELAYED_AUDIT_LOG_ENTRY', count: 1, delayParam: 'auditLogDelayMs', isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(2),
      assertTargetDetectionPresent({ minDetections: 1 })
    ]
  }),

  defineScenario({
    id: 'TC-006',
    name: 'delayed-target-detection-window',
    title: 'Delayed Target Detection Evaluation',
    description:
      'Evaluates whether delayed detections from Astra Astra are accurately measured and flagged if exceeding latency budgets.',
    category: SCENARIO_CATEGORIES.TIMING_CORRELATION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Detection Latency Bound Enforcement',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { maxAllowedDetectionLatencyMs: 3000, intervalMs: 10 },
    expectedOutcome: { maliciousStimulus: true, maxDetectionLatencyMs: 3000 },
    eventSequence: [
      { eventType: 'DELAYED_DETECTION_PROBE', count: 2, isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(2),
      assertTargetDetectionPresent({ minDetections: 1 }),
      assertDetectionLatencyWithin(3000)
    ]
  }),

  defineScenario({
    id: 'TC-007',
    name: 'simultaneous-multi-vector-suspicious-events',
    title: 'Simultaneous Multi-Vector Suspicious Events',
    description:
      'Emits concurrent channel deletion, role permission escalation, and webhook creation with identical timestamps.',
    category: SCENARIO_CATEGORIES.TIMING_CORRELATION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Cross-Vector Incident Correlation',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 0 },
    expectedOutcome: { maliciousStimulus: true, expectedTargetDetection: true },
    eventSequence: [
      { eventType: 'SIMULTANEOUS_CHANNEL_DELETE', count: 1, isMaliciousStimulus: true },
      { eventType: 'SIMULTANEOUS_ROLE_ESCALATION', count: 1, isMaliciousStimulus: true },
      { eventType: 'SIMULTANEOUS_WEBHOOK_CREATE', count: 1, isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(3),
      assertTargetDetectionPresent({ minDetections: 1 })
    ]
  }),

  defineScenario({
    id: 'TC-008',
    name: 'repeated-alert-storm-control',
    title: 'Repeated Alerts and Alert-Storm Correlation',
    description:
      'Tests whether sustained suspicious events cause uncontrolled duplicate alert storms in target telemetry.',
    category: SCENARIO_CATEGORIES.TIMING_CORRELATION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Alert Storm Coalescing',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { stimulusCount: 5, maxDuplicateAlerts: 0, intervalMs: 8 },
    expectedOutcome: { maliciousStimulus: true, maxDuplicateAlerts: 0 },
    eventSequence: [
      { eventType: 'SUSTAINED_WEBHOOK_ABUSE', countParam: 'stimulusCount', isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(5),
      assertTargetDetectionPresent({ minDetections: 1 }),
      assertNoDuplicateTargetAlerts(0)
    ]
  }),

  defineScenario({
    id: 'TC-009',
    name: 'configurable-interval-spaced-events',
    title: 'Events Separated by Configurable Intervals',
    description:
      'Emits suspicious actions paced across configurable intervals to evaluate low-and-slow threshold evasions.',
    category: SCENARIO_CATEGORIES.TIMING_CORRELATION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Low-and-Slow Window Accumulation',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { eventCount: 3, intervalMs: 25 },
    expectedOutcome: { maliciousStimulus: true, expectedTargetDetection: true },
    eventSequence: [
      { eventType: 'PACED_CHANNEL_DELETE', countParam: 'eventCount', isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(3),
      assertTargetDetectionPresent({ minDetections: 1 })
    ]
  })
];
