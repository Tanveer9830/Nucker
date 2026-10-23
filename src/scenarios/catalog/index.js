import { eventDetectionScenarios } from './eventDetection.js';
import { falsePositiveResistanceScenarios } from './falsePositiveResistance.js';
import { incidentResponseScenarios } from './incidentResponse.js';
import { reliabilityScenarios } from './reliability.js';
import { timingCorrelationScenarios } from './timingCorrelation.js';

export const SCENARIO_CATALOG = Object.freeze([
  ...eventDetectionScenarios,
  ...timingCorrelationScenarios,
  ...reliabilityScenarios,
  ...falsePositiveResistanceScenarios,
  ...incidentResponseScenarios
]);

// Startup sanity check: guarantee unique IDs across the entire catalog
const seenIds = new Set();
for (const scenario of SCENARIO_CATALOG) {
  if (seenIds.has(scenario.id)) {
    throw new Error(`Duplicate scenario ID detected in catalog: ${scenario.id}`);
  }
  seenIds.add(scenario.id);
}

export function getScenarioById(scenarioId) {
  return SCENARIO_CATALOG.find((s) => s.id === scenarioId) || null;
}

export function listScenariosByCategory(category = null) {
  if (!category) return [...SCENARIO_CATALOG];
  return SCENARIO_CATALOG.filter((s) => s.category === category);
}
