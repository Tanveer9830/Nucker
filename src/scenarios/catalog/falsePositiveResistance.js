import { RISK_CATEGORIES, SCENARIO_CATEGORIES } from '../../utils/constants.js';
import { defineScenario } from '../schema.js';
import {
  assertStimulusTimelineComplete,
  assertZeroFalsePositiveAlerts
} from './assertionHelpers.js';

export const falsePositiveResistanceScenarios = [
  defineScenario({
    id: 'FPR-001',
    name: 'legitimate-administrator-actions',
    title: 'Legitimate Administrator Moderation Actions',
    description:
      'Simulates single-member moderation actions by an allowlisted/trusted guild administrator to verify zero false-positive anti-nuke triggers.',
    category: SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Allowlisted Admin False-Positive Suppression',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { actionCount: 2, intervalMs: 15 },
    expectedOutcome: { maliciousStimulus: false, expectedTargetDetection: false },
    eventSequence: [
      {
        eventType: 'BENIGN_ADMIN_SINGLE_TIMEOUT',
        countParam: 'actionCount',
        isMaliciousStimulus: false,
        payloadTemplate: { actorTrustedAdmin: true, reason: 'Rule violation moderation' }
      }
    ],
    assertions: [assertStimulusTimelineComplete(2), assertZeroFalsePositiveAlerts()]
  }),

  defineScenario({
    id: 'FPR-002',
    name: 'normal-channel-maintenance',
    title: 'Normal Channel Maintenance Operations',
    description:
      'Simulates routine channel topic, slowmode, and category reordering maintenance.',
    category: SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Channel Maintenance Noise Filtering',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { updateCount: 2, intervalMs: 15 },
    expectedOutcome: { maliciousStimulus: false, expectedTargetDetection: false },
    eventSequence: [
      {
        eventType: 'BENIGN_CHANNEL_TOPIC_UPDATE',
        countParam: 'updateCount',
        isMaliciousStimulus: false,
        payloadTemplate: { slowmodeSeconds: 5 }
      }
    ],
    assertions: [assertStimulusTimelineComplete(2), assertZeroFalsePositiveAlerts()]
  }),

  defineScenario({
    id: 'FPR-003',
    name: 'benign-role-cosmetic-updates',
    title: 'Benign Role Color and Hoist Updates',
    description:
      'Simulates non-privileged role color, icon, and display-name updates with unchanged permission bitfields.',
    category: SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Permission-Diff Role Inspection',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { roleUpdates: 2, intervalMs: 12 },
    expectedOutcome: { maliciousStimulus: false, expectedTargetDetection: false },
    eventSequence: [
      {
        eventType: 'BENIGN_ROLE_COLOR_UPDATE',
        countParam: 'roleUpdates',
        isMaliciousStimulus: false,
        payloadTemplate: { permissionsChanged: false, colorHex: '#3B82F6' }
      }
    ],
    assertions: [assertStimulusTimelineComplete(2), assertZeroFalsePositiveAlerts()]
  }),

  defineScenario({
    id: 'FPR-004',
    name: 'routine-authorized-webhook-changes',
    title: 'Routine Authorized Webhook Rotation',
    description:
      'Simulates a single authorized webhook name/avatar update in a dedicated ops channel.',
    category: SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Benign Webhook Maintenance Filtering',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 10 },
    expectedOutcome: { maliciousStimulus: false, expectedTargetDetection: false },
    eventSequence: [
      {
        eventType: 'BENIGN_WEBHOOK_METADATA_UPDATE',
        count: 1,
        isMaliciousStimulus: false,
        payloadTemplate: { authorizedOpsChannel: true }
      }
    ],
    assertions: [assertStimulusTimelineComplete(1), assertZeroFalsePositiveAlerts()]
  }),

  defineScenario({
    id: 'FPR-005',
    name: 'authorized-guild-configuration-changes',
    title: 'Authorized Non-Degrading Guild Configuration Changes',
    description:
      'Simulates benign server banner/AFK timeout updates that do not weaken guild security controls.',
    category: SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Guild Config Security-Impact Classification',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 10 },
    expectedOutcome: { maliciousStimulus: false, expectedTargetDetection: false },
    eventSequence: [
      {
        eventType: 'BENIGN_GUILD_AFK_TIMEOUT_UPDATE',
        count: 1,
        isMaliciousStimulus: false,
        payloadTemplate: { afkTimeoutSeconds: 900, securityControlsChanged: false }
      }
    ],
    assertions: [assertStimulusTimelineComplete(1), assertZeroFalsePositiveAlerts()]
  }),

  defineScenario({
    id: 'FPR-006',
    name: 'rapid-multiple-benign-actions',
    title: 'Multiple Benign Actions Occurring Rapidly',
    description:
      'Simulates rapid onboarding role assignments of non-privileged cosmetic roles to verify burst heuristics distinguish privilege impact.',
    category: SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Rapid Benign Burst Differentiation',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { benignBurstCount: 5, intervalMs: 6 },
    expectedOutcome: { maliciousStimulus: false, expectedTargetDetection: false },
    eventSequence: [
      {
        eventType: 'BENIGN_MEMBER_COSMETIC_ROLE_ASSIGN',
        countParam: 'benignBurstCount',
        isMaliciousStimulus: false,
        payloadTemplate: { privilegedRole: false }
      }
    ],
    assertions: [assertStimulusTimelineComplete(5), assertZeroFalsePositiveAlerts()]
  })
];
