import { version as djsVersion, SlashCommandBuilder } from 'discord.js';
import { sanitizeConfigForDisplay } from '../config/index.js';
import { replyEphemeral } from '../interactions/respond.js';
import { SCENARIO_CATALOG } from '../scenarios/catalog/index.js';
import {
  APP_NAME,
  APP_VERSION,
  CREATOR_ATTRIBUTION,
  TARGET_SYSTEM_ALIAS,
  TARGET_SYSTEM_NAME
} from '../utils/constants.js';

export const stopCommand = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Immediately cancel all active observations, simulations, and queued tasks.')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    const outcome = await context.taskManager.stopAll({
      reason: `Emergency /stop invoked by operator ${interaction.user.id}`
    });

    const lines = ['**TANVEER KA BETA NEWKER — EMERGENCY STOP EXECUTED**'];
    if (!outcome.stopped) {
      lines.push('- **Status:** No active simulations or observation runs were running.');
    } else {
      lines.push(`- **Cancelled Active Runs:** ${outcome.cancelledRuns.map((id) => `\`${id}\``).join(', ')}`);
      lines.push(`- **Cancelled In-Flight Scenarios:** ${outcome.cancelledActiveExecutions}`);
      lines.push(`- **Cancelled Queued Scenarios:** ${outcome.cancelledQueuedCount}`);
      lines.push(`- **Cleared Pending Timers:** ${outcome.clearedTimers}`);
      lines.push(
        `- **Cleanup Status:** ${
          outcome.incompleteCleanups.length === 0
            ? 'ALL CLEANUPS VERIFIED COMPLETE'
            : `${outcome.incompleteCleanups.length} INCOMPLETE CLEANUP ITEM(S)`
        }`
      );
      if (outcome.incompleteCleanups.length > 0) {
        for (const ic of outcome.incompleteCleanups) {
          lines.push(`  - Incomplete (\`${ic.observationId}\` / \`${ic.hookId}\`): ${ic.reason}`);
        }
      }
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return outcome;
  }
};

export const healthCommand = {
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Show internal platform component, SQLite, adapter, and rate-limiter health.')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    const dbHealth = context.db.checkIntegrity();
    const adapterHealth = await context.astraAdapter.getHealth();
    const taskSnap = context.taskManager.getStatusSnapshot();
    const rlStats = context.rateLimiter.getHealthSnapshot();
    const wsReady =
      typeof context.discordClient?.isReady === 'function'
        ? Boolean(context.discordClient.isReady())
        : false;
    const mem = process.memoryUsage();

    const lines = [
      '**TANVEER KA BETA NEWKER — INTERNAL COMPONENT HEALTH**',
      `- **SQLite Integrity:** \`${dbHealth.integrityStatus}\` (healthy=\`${dbHealth.healthy}\`, FK violations=${dbHealth.foreignKeyViolations})`,
      `- **Astra Astra Adapter:** healthy=\`${adapterHealth.healthy}\`, telemetryAvailable=\`${adapterHealth.telemetryAvailable}\`, activeSources=[${adapterHealth.activeSources.join(', ') || 'none'}]`,
      `- **Discord Gateway Client:** connected=\`${wsReady}\``,
      `- **Task Manager:** activeRuns=${taskSnap.activeRunCount}, maxConcurrency=${taskSnap.maxConcurrentScenarios}`,
      `- **Rate-Limit Executor:** total=${rlStats.totalRequests}, succeeded=${rlStats.succeededRequests}, 429s=${rlStats.rateLimitedCount}, retries=${rlStats.transientRetryCount}`,
      `- **Process Memory (RSS):** ${(mem.rss / (1024 * 1024)).toFixed(1)} MiB | Uptime: ${Math.round(process.uptime())}s`,
      '',
      `_${CREATOR_ATTRIBUTION}_`
    ];

    await replyEphemeral(interaction, lines.join('\n'));
    return { dbHealth, adapterHealth, taskSnap, rlStats };
  }
};

export const configValidateCommand = {
  data: new SlashCommandBuilder()
    .setName('config-validate')
    .setDescription('Validate runtime security configuration without exposing secrets.')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    const sanitized = sanitizeConfigForDisplay(context.config);
    const val = sanitized.validation;

    const lines = [
      '**TANVEER KA BETA NEWKER — CONFIGURATION VALIDATION**',
      `- **Valid:** \`${val.valid}\``,
      `- **Privileged Mode Enabled:** \`${sanitized.privilegedEnabled}\``,
      `- **Authorized Operator ID:** \`${sanitized.authorizedOperatorId}\``,
      `- **Simulation Mode:** \`${sanitized.simulationMode}\``,
      `- **Require Test Guild Allowlist:** \`${sanitized.requireTestGuildAllowlist}\` (${sanitized.testGuildAllowlist.length} allowlisted guild(s))`,
      `- **Discord Token Configured:** \`${sanitized.discordTokenConfigured}\``,
      `- **Errors (${val.errors.length}):** ${val.errors.length === 0 ? 'None' : val.errors.join(' | ')}`,
      `- **Warnings (${val.warnings.length}):** ${
        val.warnings.length === 0 ? 'None' : val.warnings.join(' | ')
      }`,
      '',
      `_${CREATOR_ATTRIBUTION}_`
    ];

    await replyEphemeral(interaction, lines.join('\n'));
    return sanitized;
  }
};

export const configOverviewCommand = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Inspect sanitized runtime configuration (all secrets redacted).')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    const sanitized = sanitizeConfigForDisplay(context.config);
    const text = [
      '**TANVEER KA BETA NEWKER — SANITIZED CONFIGURATION**',
      '```json',
      JSON.stringify(sanitized, null, 2),
      '```',
      `_${CREATOR_ATTRIBUTION}_`
    ].join('\n');

    await replyEphemeral(interaction, text);
    return sanitized;
  }
};

export const aboutCommand = {
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription('Show project attribution, security mission, and architecture details.')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    const lines = [
      `# ${APP_NAME.toUpperCase()}`,
      `**Creator:** ${CREATOR_ATTRIBUTION}`,
      `**Target System Under Test:** ${TARGET_SYSTEM_NAME} (\`${TARGET_SYSTEM_ALIAS}\`)`,
      `**Exclusive Operator ID:** \`${context.config.authorizedOperatorId}\``,
      '',
      'Autonomous Security Research, Anti-Nuke Evaluation & Non-Destructive Simulation Platform.',
      'Built to evaluate defensive behavior through reproducible evidence, strict source separation, transparent metrics, and instant `/stop` safety controls.',
      '',
      `_${CREATOR_ATTRIBUTION}_`
    ];
    await replyEphemeral(interaction, lines.join('\n'));
    return { appName: APP_NAME, creator: CREATOR_ATTRIBUTION };
  }
};

export const versionCommand = {
  data: new SlashCommandBuilder()
    .setName('version')
    .setDescription('Show platform, Node.js, Discord.js, and scenario catalog versions.')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    const lines = [
      `**${APP_NAME}** v\`${APP_VERSION}\``,
      `- **Creator:** ${CREATOR_ATTRIBUTION}`,
      `- **Node.js Runtime:** \`${process.version}\``,
      `- **Discord.js Version:** \`${djsVersion}\``,
      `- **Scenario Catalog:** \`${SCENARIO_CATALOG.length}\` versioned scenarios (\`1.0.0\`)`
    ];
    await replyEphemeral(interaction, lines.join('\n'));
    return { version: APP_VERSION, node: process.version, discordJs: djsVersion };
  }
};

export const helpCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the complete operator-only command reference.')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    const lines = [
      `# ${APP_NAME.toUpperCase()} — COMMAND REFERENCE`,
      `> All commands are restricted exclusively to the authorized numeric operator ID.`,
      '',
      '**Autonomous Observation**',
      '- `/observe` — Zero-argument autonomous 10-stage security observation workflow.',
      '- `/observe-status` — Display active observation stage and task state.',
      '- `/observe-history` — List previous observation runs.',
      '- `/observe-report` (alias `/report`) — Regenerate & view private report from SQLite.',
      '- `/observe-export` — Export persisted report as Markdown or JSON.',
      '- `/observe-compare` — Compare two runs for improvements and regressions.',
      '',
      '**Simulation Laboratory**',
      '- `/lab` — Unified laboratory overview.',
      '- `/lab-scenarios` — List all 38 versioned scenarios across Categories A–E.',
      '- `/lab-status` — Show active simulation jobs and concurrency slots.',
      '- `/lab-report` — Show scenario assertion outcomes.',
      '- `/lab-replay` — Replay a prior simulation execution.',
      '- `/lab-cleanup` — Audit post-simulation cleanup verification records.',
      '- `/nuke` — Inspect or revalidate Part-10 `READY_FOR_APPROVAL` non-destructive simulation gate.',
      '',
      '**Security Evaluation**',
      '- `/security` — Unified security posture summary.',
      '- `/security-assess` — Evaluate persisted evidence by source type.',
      '- `/security-score` — View transparent formula-backed security score.',
      '- `/security-findings` — List defects, weaknesses, and informational observations.',
      '- `/security-regressions` — Inspect regression baselines and deltas.',
      '- `/security-recommendations` — View evidence-linked remediation guidance.',
      '',
      '**Control & Maintenance**',
      '- `/stop` — Immediately cancel all active simulations and timers.',
      '- `/health` — Show SQLite, adapter, task-manager, and rate-limiter health.',
      '- `/config-validate` (and `/config`) — Validate & view sanitized configuration.',
      '- `/about`, `/version`, `/help` — Platform identity, runtime versions, and help.',
      '',
      `_${CREATOR_ATTRIBUTION}_`
    ];
    await replyEphemeral(interaction, lines.join('\n'));
    return { commandCount: 27 };
  }
};
