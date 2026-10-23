import { AuthorizationGate } from '../auth/authorizationGate.js';
import {
  aboutCommand,
  configOverviewCommand,
  configValidateCommand,
  healthCommand,
  helpCommand,
  stopCommand,
  versionCommand
} from './controlCommands.js';
import {
  labCleanupCommand,
  labOverviewCommand,
  labReplayCommand,
  labReportCommand,
  labScenariosCommand,
  labStatusCommand,
  nukeGateCommand
} from './labCommands.js';
import {
  observeCommand,
  observeCompareCommand,
  observeExportCommand,
  observeHistoryCommand,
  observeReportCommand,
  observeStatusCommand,
  reportAliasCommand
} from './observationCommands.js';
import {
  securityAssessCommand,
  securityFindingsCommand,
  securityOverviewCommand,
  securityRecommendationsCommand,
  securityRegressionsCommand,
  securityScoreCommand
} from './securityCommands.js';

export const RAW_COMMAND_MODULES = Object.freeze([
  observeCommand,
  observeStatusCommand,
  observeHistoryCommand,
  observeReportCommand,
  observeExportCommand,
  observeCompareCommand,
  labScenariosCommand,
  labStatusCommand,
  labReportCommand,
  labReplayCommand,
  labCleanupCommand,
  securityAssessCommand,
  securityScoreCommand,
  securityFindingsCommand,
  securityRegressionsCommand,
  securityRecommendationsCommand,
  stopCommand,
  healthCommand,
  configValidateCommand,
  aboutCommand,
  versionCommand,
  helpCommand,
  // Part-3 top-level operator-only commands
  nukeGateCommand,
  labOverviewCommand,
  securityOverviewCommand,
  reportAliasCommand,
  configOverviewCommand
]);

/**
 * Wraps every command module in centralized server-side AuthorizationGate middleware
 * and validates structural invariants (unique names, zero-argument /observe, 100% middleware brand).
 */
export function buildAuthorizedCommandRegistry(authGate) {
  if (!(authGate instanceof AuthorizationGate)) {
    throw new Error('buildAuthorizedCommandRegistry requires an AuthorizationGate instance.');
  }

  const registry = new Map();

  for (const mod of RAW_COMMAND_MODULES) {
    const json = mod.data.toJSON();
    if (registry.has(json.name)) {
      throw new Error(`Duplicate slash command name "${json.name}" detected.`);
    }

    if (json.name === 'observe' && Array.isArray(json.options) && json.options.length > 0) {
      throw new Error('Central invariant violated: /observe must take ZERO arguments.');
    }

    const wrapped = authGate.wrapCommand(mod);
    if (!AuthorizationGate.isWrapped(wrapped)) {
      throw new Error(`Command "/${json.name}" failed AuthorizationGate middleware verification.`);
    }

    registry.set(json.name, wrapped);
  }

  return registry;
}

export function getApplicationCommandsJsonPayload() {
  return RAW_COMMAND_MODULES.map((m) => m.data.toJSON());
}
