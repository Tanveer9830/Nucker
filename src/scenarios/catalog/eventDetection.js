import { RISK_CATEGORIES, SCENARIO_CATEGORIES } from '../../utils/constants.js';
import { defineScenario } from '../schema.js';
import {
  assertStimulusTimelineComplete,
  assertTargetDetectionPresent
} from './assertionHelpers.js';

export const eventDetectionScenarios = [
  defineScenario({
    id: 'ED-001',
    name: 'suspicious-channel-create-delete-sequence',
    title: 'Suspicious Channel Creation and Deletion Sequences',
    description:
      'Simulates rapid channel creation followed by unauthorized channel deletion burst to evaluate channel-nuke detection.',
    category: SCENARIO_CATEGORIES.EVENT_DETECTION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Anti-Channel-Nuke Detection',
    preconditions: {
      requiresSimulationMode: true,
      requiresTargetTelemetry: false,
      requiredPermissions: ['ViewChannel', 'ViewAuditLog']
    },
    parameters: {
      createCount: 3,
      deleteCount: 3,
      intervalMs: 15
    },
    expectedOutcome: {
      maliciousStimulus: true,
      expectedTargetDetection: true,
      maxDetectionLatencyMs: 5000
    },
    eventSequence: [
      { eventType: 'CHANNEL_CREATE', countParam: 'createCount', isMaliciousStimulus: true },
      { eventType: 'CHANNEL_DELETE', countParam: 'deleteCount', isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(6),
      assertTargetDetectionPresent({
        minDetections: 1,
        description: 'Astra Astra should flag rapid channel create/delete burst.'
      })
    ]
  }),

  defineScenario({
    id: 'ED-002',
    name: 'role-creation-deletion-pattern',
    title: 'Suspicious Role Creation and Deletion Patterns',
    description:
      'Simulates rapid creation and mass deletion of guild roles characteristic of role-wiping raids.',
    category: SCENARIO_CATEGORIES.EVENT_DETECTION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Anti-Role-Wipe Detection',
    preconditions: {
      requiresSimulationMode: true,
      requiresTargetTelemetry: false,
      requiredPermissions: ['ViewAuditLog']
    },
    parameters: {
      roleCreateCount: 3,
      roleDeleteCount: 3,
      intervalMs: 15
    },
    expectedOutcome: {
      maliciousStimulus: true,
      expectedTargetDetection: true
    },
    eventSequence: [
      { eventType: 'ROLE_CREATE', countParam: 'roleCreateCount', isMaliciousStimulus: true },
      { eventType: 'ROLE_DELETE', countParam: 'roleDeleteCount', isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(6),
      assertTargetDetectionPresent({
        minDetections: 1,
        description: 'Astra Astra should detect abnormal role creation/deletion churn.'
      })
    ]
  }),

  defineScenario({
    id: 'ED-003',
    name: 'dangerous-permission-escalation',
    title: 'Dangerous Permission Escalation Changes',
    description:
      'Simulates granting dangerous permissions (Administrator, ManageGuild, ManageRoles, BanMembers, ManageWebhooks) to an untrusted role.',
    category: SCENARIO_CATEGORIES.EVENT_DETECTION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Privilege Escalation Guard',
    preconditions: {
      requiresSimulationMode: true,
      requiresTargetTelemetry: false,
      requiredPermissions: ['ViewAuditLog']
    },
    parameters: {
      escalatedPermissions: ['Administrator', 'ManageGuild', 'ManageRoles', 'BanMembers'],
      intervalMs: 10
    },
    expectedOutcome: {
      maliciousStimulus: true,
      expectedTargetDetection: true
    },
    eventSequence: [
      {
        eventType: 'ROLE_PERMISSION_ESCALATION',
        count: 2,
        isMaliciousStimulus: true,
        payloadTemplate: { addedPermissions: ['Administrator', 'ManageGuild'] }
      }
    ],
    assertions: [
      assertStimulusTimelineComplete(2),
      assertTargetDetectionPresent({
        minDetections: 1,
        description: 'Astra Astra should alert on unapproved dangerous permission grants.'
      })
    ]
  }),

  defineScenario({
    id: 'ED-004',
    name: 'simulated-mass-ban-kick-burst',
    title: 'Simulated Mass-Ban and Mass-Kick Bursts',
    description:
      'Simulates high-velocity member ban and kick audit events inside the non-destructive engine to evaluate member-purge protection.',
    category: SCENARIO_CATEGORIES.EVENT_DETECTION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Anti-Mass-Ban / Anti-Mass-Kick',
    preconditions: {
      requiresSimulationMode: true,
      requiresTargetTelemetry: false,
      requiredPermissions: ['ViewAuditLog']
    },
    parameters: {
      banCount: 4,
      kickCount: 4,
      intervalMs: 10
    },
    expectedOutcome: {
      maliciousStimulus: true,
      expectedTargetDetection: true
    },
    eventSequence: [
      { eventType: 'MEMBER_BAN_ADD', countParam: 'banCount', isMaliciousStimulus: true },
      { eventType: 'MEMBER_KICK', countParam: 'kickCount', isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(8),
      assertTargetDetectionPresent({
        minDetections: 1,
        description: 'Astra Astra should detect rapid mass-ban / mass-kick bursts.'
      })
    ]
  }),

  defineScenario({
    id: 'ED-005',
    name: 'suspicious-webhook-lifecycle',
    title: 'Suspicious Webhook Creation and Mutation',
    description:
      'Simulates rapid unauthorized webhook creation across multiple channels used for raid spam evasion.',
    category: SCENARIO_CATEGORIES.EVENT_DETECTION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Anti-Webhook Abuse Detection',
    preconditions: {
      requiresSimulationMode: true,
      requiresTargetTelemetry: false,
      requiredPermissions: ['ViewAuditLog']
    },
    parameters: {
      webhookCount: 4,
      intervalMs: 12
    },
    expectedOutcome: {
      maliciousStimulus: true,
      expectedTargetDetection: true
    },
    eventSequence: [
      { eventType: 'WEBHOOK_CREATE', countParam: 'webhookCount', isMaliciousStimulus: true }
    ],
    assertions: [
      assertStimulusTimelineComplete(4),
      assertTargetDetectionPresent({
        minDetections: 1,
        description: 'Astra Astra should detect unauthorized multi-channel webhook creation.'
      })
    ]
  }),

  defineScenario({
    id: 'ED-006',
    name: 'unexpected-unverified-bot-addition',
    title: 'Unexpected Unverified Bot Additions',
    description:
      'Simulates adding an unallowlisted bot account with elevated guild permissions.',
    category: SCENARIO_CATEGORIES.EVENT_DETECTION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Anti-Rogue-Bot Quarantine',
    preconditions: {
      requiresSimulationMode: true,
      requiresTargetTelemetry: false,
      requiredPermissions: ['ViewAuditLog']
    },
    parameters: {
      botJoinCount: 1,
      intervalMs: 10
    },
    expectedOutcome: {
      maliciousStimulus: true,
      expectedTargetDetection: true
    },
    eventSequence: [
      {
        eventType: 'BOT_ADD_UNVERIFIED',
        countParam: 'botJoinCount',
        isMaliciousStimulus: true,
        payloadTemplate: { verifiedDiscordApp: false, requestedAdmin: true }
      }
    ],
    assertions: [
      assertStimulusTimelineComplete(1),
      assertTargetDetectionPresent({
        minDetections: 1,
        description: 'Astra Astra should flag unallowlisted bot additions.'
      })
    ]
  }),

  defineScenario({
    id: 'ED-007',
    name: 'unusual-guild-configuration-mutation',
    title: 'Unusual Guild Configuration Changes',
    description:
      'Simulates suspicious guild-wide configuration mutations (verification level downgrade, vanity URL change, system channel removal).',
    category: SCENARIO_CATEGORIES.EVENT_DETECTION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    affectedCapability: 'Guild Settings Integrity Protection',
    preconditions: {
      requiresSimulationMode: true,
      requiresTargetTelemetry: false,
      requiredPermissions: ['ViewAuditLog']
    },
    parameters: {
      mutationCount: 2,
      intervalMs: 15
    },
    expectedOutcome: {
      maliciousStimulus: true,
      expectedTargetDetection: true
    },
    eventSequence: [
      {
        eventType: 'GUILD_CONFIG_DANGEROUS_UPDATE',
        countParam: 'mutationCount',
        isMaliciousStimulus: true,
        payloadTemplate: { verificationLevelBefore: 'HIGH', verificationLevelAfter: 'NONE' }
      }
    ],
    assertions: [
      assertStimulusTimelineComplete(2),
      assertTargetDetectionPresent({
        minDetections: 1,
        description: 'Astra Astra should detect security-degrading guild configuration mutations.'
      })
    ]
  })
];
