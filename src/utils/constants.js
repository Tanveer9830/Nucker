/**
 * Tanveer Ka Beta Newker — Core Platform Constants & Enumerations
 * Creator: MADE BY TANVEER
 */

export const APP_NAME = 'Tanveer Ka Beta Newker';
export const CREATOR_ATTRIBUTION = 'MADE BY TANVEER';
export const APP_VERSION = '1.0.0';
export const DEFAULT_OPERATOR_ID = '1131248987173814336';
export const TARGET_SYSTEM_NAME = 'Astra Astra';
export const TARGET_SYSTEM_ALIAS = 'AstraMaster';

export const OBSERVATION_STAGES = Object.freeze([
  { index: 1, key: 'INITIALIZING_ASSESSMENT', label: 'Initializing security assessment.' },
  { index: 2, key: 'VERIFYING_AUTH_AND_ENVIRONMENT', label: 'Verifying authorization and environment.' },
  { index: 3, key: 'INSPECTING_DISCORD_METADATA', label: 'Inspecting available Discord metadata.' },
  { index: 4, key: 'IDENTIFYING_TARGET_INTEGRATIONS', label: 'Identifying configured target integrations.' },
  { index: 5, key: 'CHECKING_PERMISSIONS_AND_COLLECTORS', label: 'Checking permissions and collector health.' },
  { index: 6, key: 'PREPARING_TEST_SCENARIOS', label: 'Preparing test scenarios.' },
  { index: 7, key: 'RUNNING_CONTROLLED_SIMULATIONS', label: 'Running controlled simulations.' },
  { index: 8, key: 'CORRELATING_EVIDENCE', label: 'Correlating evidence.' },
  { index: 9, key: 'CALCULATING_METRICS', label: 'Calculating metrics.' },
  { index: 10, key: 'PREPARING_PRIVATE_REPORT', label: 'Preparing the private report.' }
]);

export const EVIDENCE_SOURCES = Object.freeze({
  LIVE_DISCORD_OBSERVATION: 'Live Discord observation',
  IMPORTED_ASTRA_TELEMETRY: 'Imported Astra Astra telemetry',
  SIMULATED_EVENT: 'Simulated event',
  TEST_ENGINE_ASSERTION: 'Test-engine assertion',
  ANALYST_INFERENCE: 'Analyst inference'
});

export const EVIDENCE_SOURCE_KEYS = Object.freeze(Object.keys(EVIDENCE_SOURCES));
export const EVIDENCE_SOURCE_VALUES = Object.freeze(Object.values(EVIDENCE_SOURCES));

export const SCENARIO_RESULTS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  PARTIAL: 'PARTIAL',
  BLOCKED: 'BLOCKED',
  INCONCLUSIVE: 'INCONCLUSIVE',
  CANCELLED: 'CANCELLED'
});

export const SCENARIO_CATEGORIES = Object.freeze({
  EVENT_DETECTION: 'EVENT_DETECTION',
  TIMING_CORRELATION: 'TIMING_CORRELATION',
  RELIABILITY: 'RELIABILITY',
  FALSE_POSITIVE_RESISTANCE: 'FALSE_POSITIVE_RESISTANCE',
  INCIDENT_RESPONSE: 'INCIDENT_RESPONSE'
});

export const RISK_CATEGORIES = Object.freeze({
  SAFE_INTERNAL: 'SAFE_INTERNAL',
  NON_DESTRUCTIVE_SIMULATION: 'NON_DESTRUCTIVE_SIMULATION',
  CONTROLLED_APPROVAL_ONLY: 'CONTROLLED_APPROVAL_ONLY'
});

export const SCENARIO_STATES = Object.freeze({
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  VALIDATING: 'VALIDATING',
  RUNNING: 'RUNNING',
  CORRELATING: 'CORRELATING',
  EVALUATING: 'EVALUATING',
  CLEANING_UP: 'CLEANING_UP',
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED'
});

export const FINDING_CLASSIFICATIONS = Object.freeze({
  CONFIRMED_DEFECT: 'CONFIRMED_DEFECT',
  SUSPECTED_WEAKNESS: 'SUSPECTED_WEAKNESS',
  INFORMATIONAL_OBSERVATION: 'INFORMATIONAL_OBSERVATION'
});

export const SEVERITY_LEVELS = Object.freeze({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INFO: 'INFO'
});

export const CONFIDENCE_LEVELS = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
});

export const ASSESSMENT_STATES = Object.freeze({
  READY_FOR_APPROVAL: 'READY_FOR_APPROVAL',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  APPROVAL_REVOKED: 'APPROVAL_REVOKED',
  APPROVED_SINGLE_RUN: 'APPROVED_SINGLE_RUN'
});

export const TARGET_IDENTIFICATION_STATES = Object.freeze({
  VERIFIED: 'VERIFIED',
  AMBIGUOUS: 'AMBIGUOUS',
  UNCONFIGURED: 'UNCONFIGURED',
  CONFIGURED_NOT_PRESENT: 'CONFIGURED_NOT_PRESENT',
  TELEMETRY_ONLY: 'TELEMETRY_ONLY'
});

export const OVERALL_OBSERVATION_STATUSES = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  RUNNING: 'RUNNING',
  COMPLETED_VERIFIED_TELEMETRY: 'COMPLETED_VERIFIED_TELEMETRY',
  COMPLETED_PARTIAL_VISIBILITY: 'COMPLETED_PARTIAL_VISIBILITY',
  COMPLETED_SIMULATION_ONLY: 'COMPLETED_SIMULATION_ONLY',
  READY_FOR_APPROVAL: 'READY_FOR_APPROVAL',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  INTERRUPTED_BY_RESTART: 'INTERRUPTED_BY_RESTART'
});

// Narrow least-privilege Discord permissions recommended for observation (never Administrator!)
export const RECOMMENDED_OBSERVATION_PERMISSIONS = Object.freeze([
  'ViewChannel',
  'ViewAuditLog',
  'ReadMessageHistory',
  'SendMessages',
  'EmbedLinks',
  'AttachFiles'
]);
