import { RISK_CATEGORIES, SCENARIO_CATEGORIES } from '../utils/constants.js';

const VALID_CATEGORIES = new Set(Object.values(SCENARIO_CATEGORIES));
const VALID_RISK_CATEGORIES = new Set(Object.values(RISK_CATEGORIES));

export function validateScenarioDefinition(scenario) {
  const errors = [];
  if (!scenario || typeof scenario !== 'object') {
    throw new Error('Scenario definition must be an object.');
  }

  const requiredStringFields = ['id', 'version', 'name', 'title', 'description', 'affectedCapability'];
  for (const field of requiredStringFields) {
    if (typeof scenario[field] !== 'string' || scenario[field].trim().length === 0) {
      errors.push(`Scenario "${scenario.id || 'UNKNOWN'}" is missing required string field "${field}".`);
    }
  }

  if (!VALID_CATEGORIES.has(scenario.category)) {
    errors.push(`Scenario "${scenario.id}" has invalid category "${scenario.category}".`);
  }
  if (!VALID_RISK_CATEGORIES.has(scenario.riskCategory)) {
    errors.push(`Scenario "${scenario.id}" has invalid riskCategory "${scenario.riskCategory}".`);
  }
  if (!scenario.preconditions || typeof scenario.preconditions !== 'object') {
    errors.push(`Scenario "${scenario.id}" is missing preconditions object.`);
  }
  if (!scenario.parameters || typeof scenario.parameters !== 'object') {
    errors.push(`Scenario "${scenario.id}" is missing parameters object.`);
  }
  if (!scenario.expectedOutcome || typeof scenario.expectedOutcome !== 'object') {
    errors.push(`Scenario "${scenario.id}" is missing expectedOutcome object.`);
  }
  if (!Array.isArray(scenario.eventSequence) || scenario.eventSequence.length === 0) {
    errors.push(`Scenario "${scenario.id}" must define a non-empty eventSequence array.`);
  }
  if (!Array.isArray(scenario.assertions) || scenario.assertions.length === 0) {
    errors.push(`Scenario "${scenario.id}" must define a non-empty assertions array.`);
  }
  if (typeof scenario.timeoutMs !== 'number' || scenario.timeoutMs < 100 || scenario.timeoutMs > 300000) {
    errors.push(`Scenario "${scenario.id}" must define timeoutMs between 100 and 300000.`);
  }
  if (!scenario.cancellationBehavior || typeof scenario.cancellationBehavior !== 'object') {
    errors.push(`Scenario "${scenario.id}" is missing cancellationBehavior.`);
  }
  if (!Array.isArray(scenario.evidenceReferences)) {
    errors.push(`Scenario "${scenario.id}" must include evidenceReferences array template.`);
  }
  if (!scenario.cleanupRequirements || typeof scenario.cleanupRequirements !== 'object') {
    errors.push(`Scenario "${scenario.id}" is missing cleanupRequirements.`);
  }
  if (!('finalResult' in scenario)) {
    errors.push(`Scenario "${scenario.id}" must include finalResult property.`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid scenario definition (${scenario.id || 'UNKNOWN'}): ${errors.join(' ')}`);
  }

  return scenario;
}

/**
 * Helper factory that constructs a validated, standardized scenario definition.
 */
export function defineScenario(spec) {
  const full = {
    version: '1.0.0',
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    timeoutMs: 10000,
    cancellationBehavior: {
      mode: 'IMMEDIATE_ABORT_WITH_CLEANUP',
      persistPartialTimeline: true,
      maxCleanupMs: 1000
    },
    evidenceReferences: [],
    cleanupRequirements: {
      reversible: true,
      actions: ['Clear ephemeral simulation state', 'Verify zero live guild mutations']
    },
    finalResult: null,
    ...spec
  };
  return validateScenarioDefinition(full);
}
