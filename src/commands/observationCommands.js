import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder
} from 'discord.js';
import { replyEphemeral } from '../interactions/respond.js';
import { renderStageProgressMessage } from '../observe/workflow.js';
import { CREATOR_ATTRIBUTION } from '../utils/constants.js';

export const observeCommand = {
  // ZERO ARGUMENTS — central requirement (Part 4)
  data: new SlashCommandBuilder()
    .setName('observe')
    .setDescription('Run the autonomous zero-argument security observation workflow.')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    if (!interaction.deferred && !interaction.replied && typeof interaction.deferReply === 'function') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    const result = await context.observationWorkflow.run({ interaction });
    return result;
  }
};

export const observeStatusCommand = {
  data: new SlashCommandBuilder()
    .setName('observe-status')
    .setDescription('Display the current autonomous observation state and active tasks.')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    const taskSnapshot = context.taskManager.getStatusSnapshot();
    const latestRun = context.repositories.getLatestObservationRun();

    const lines = ['**TANVEER KA BETA NEWKER — OBSERVATION STATUS**'];
    lines.push(`Active Observation Runs: **${taskSnapshot.activeRunCount}**`);

    if (taskSnapshot.runs.length > 0) {
      for (const r of taskSnapshot.runs) {
        lines.push(
          `- Active Run \`${r.observationId}\` | Active Scenarios: ${r.activeExecutionCount} | Queued: ${r.queuedScenarioCount}`
        );
      }
    }

    if (latestRun) {
      lines.push('');
      lines.push(`Latest Recorded Run: \`${latestRun.observation_id}\``);
      lines.push(`Status: \`${latestRun.overall_status}\` | Assessment: \`${latestRun.assessment_state}\``);
      lines.push(`Started: ${latestRun.started_at} | Completed: ${latestRun.completed_at || 'IN_PROGRESS'}`);
      if (Array.isArray(latestRun.stages) && latestRun.stages.length > 0) {
        lines.push('');
        lines.push(renderStageProgressMessage(latestRun.observation_id, latestRun.stages));
      }
    } else {
      lines.push('', 'No observation runs have been recorded yet. Type `/observe` to start.');
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_observe_status_refresh')
        .setLabel('Refresh Status')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('btn_emergency_stop')
        .setLabel('Emergency Stop')
        .setStyle(ButtonStyle.Danger)
    );

    await replyEphemeral(interaction, lines.join('\n'), { components: [row] });
    return { activeRunCount: taskSnapshot.activeRunCount, latestRunId: latestRun?.observation_id || null };
  }
};

export const observeHistoryCommand = {
  data: new SlashCommandBuilder()
    .setName('observe-history')
    .setDescription('List previous security observation runs.')
    .setDefaultMemberPermissions(0)
    .addIntegerOption((opt) =>
      opt
        .setName('limit')
        .setDescription('Maximum runs to display (1-25)')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),

  async execute(interaction, context) {
    const limit = interaction.options?.getInteger?.('limit') ?? 10;
    const runs = context.repositories.listObservationRuns(limit);

    const lines = [
      `**TANVEER KA BETA NEWKER — OBSERVATION HISTORY (Last ${runs.length})**`,
      ''
    ];

    if (runs.length === 0) {
      lines.push('No previous observation runs found.');
    } else {
      for (const r of runs) {
        const counts = r.metrics?.counts || {};
        lines.push(
          `- \`${r.observation_id}\` | \`${r.overall_status}\` | Guild: \`${r.guild_id || 'N/A'}\` | P:${counts.passed ?? 0} F:${counts.failed ?? 0} B:${counts.blocked ?? 0} I:${counts.inconclusive ?? 0} | ${r.started_at}`
        );
      }
    }
    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return { count: runs.length };
  }
};

export const observeReportCommand = {
  data: new SlashCommandBuilder()
    .setName('observe-report')
    .setDescription('Display or regenerate a private observation report from SQLite.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('observation_id')
        .setDescription('Optional Observation ID (defaults to latest run)')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    const requestedId = interaction.options?.getString?.('observation_id') || null;
    const targetRun = requestedId
      ? context.repositories.getObservationRun(requestedId)
      : context.repositories.getLatestObservationRun();

    if (!targetRun) {
      await replyEphemeral(
        interaction,
        requestedId
          ? `Observation run \`${requestedId}\` was not found in SQLite.`
          : 'No observation runs exist yet. Execute `/observe` first.'
      );
      return { found: false };
    }

    const regenerated = context.reportGenerator.generateFromDatabase(targetRun.observation_id);
    await replyEphemeral(interaction, regenerated.renderedMarkdown);
    return { found: true, observationId: targetRun.observation_id };
  }
};

export const observeExportCommand = {
  data: new SlashCommandBuilder()
    .setName('observe-export')
    .setDescription('Export a persisted observation report as Markdown or JSON.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('format')
        .setDescription('Export format')
        .addChoices(
          { name: 'Markdown (.md)', value: 'markdown' },
          { name: 'Structured JSON (.json)', value: 'json' }
        )
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('observation_id')
        .setDescription('Optional Observation ID (defaults to latest run)')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    const format = interaction.options?.getString?.('format') || 'markdown';
    const requestedId = interaction.options?.getString?.('observation_id') || null;
    const targetRun = requestedId
      ? context.repositories.getObservationRun(requestedId)
      : context.repositories.getLatestObservationRun();

    if (!targetRun) {
      await replyEphemeral(interaction, 'No matching observation run found to export.');
      return { exported: false };
    }

    const { structuredReport, renderedMarkdown } = context.reportGenerator.generateFromDatabase(
      targetRun.observation_id
    );

    const isJson = format === 'json';
    const fileContent = isJson ? JSON.stringify(structuredReport, null, 2) : renderedMarkdown;
    const fileName = `${targetRun.observation_id}.${isJson ? 'json' : 'md'}`;

    const attachment = new AttachmentBuilder(Buffer.from(fileContent, 'utf8'), {
      name: fileName
    });

    await replyEphemeral(
      interaction,
      `Exported private report for \`${targetRun.observation_id}\` as \`${fileName}\`.\n\n_${CREATOR_ATTRIBUTION}_`,
      { files: [attachment] }
    );
    return { exported: true, observationId: targetRun.observation_id, format };
  }
};

export const observeCompareCommand = {
  data: new SlashCommandBuilder()
    .setName('observe-compare')
    .setDescription('Compare two completed observation runs for improvements and regressions.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('older_id')
        .setDescription('Baseline / older Observation ID')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('newer_id')
        .setDescription('Candidate / newer Observation ID')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    let olderId = interaction.options?.getString?.('older_id') || null;
    let newerId = interaction.options?.getString?.('newer_id') || null;

    if (!olderId || !newerId) {
      const recent = context.repositories.listObservationRuns(5);
      if (recent.length < 2) {
        await replyEphemeral(
          interaction,
          'At least 2 observation runs are required to perform `/observe-compare`.'
        );
        return { compared: false };
      }
      newerId = newerId || recent[0].observation_id;
      olderId = olderId || recent[1].observation_id;
    }

    const diff = context.securityAnalyzer.compareRuns(olderId, newerId);
    const lines = [
      `**TANVEER KA BETA NEWKER — OBSERVATION COMPARISON**`,
      `- **Older Run:** \`${diff.olderObservationId}\` (\`${diff.olderStatus}\`)`,
      `- **Newer Run:** \`${diff.newerObservationId}\` (\`${diff.newerStatus}\`)`,
      `- **Regressions (PASS -> FAIL/PARTIAL):** ${diff.regressions.length}`,
      `- **Verified Improvements (FAIL/PARTIAL -> PASS):** ${diff.improvements.length}`,
      `- **Unchanged Scenarios:** ${diff.unchangedCount}`,
      `- **Incomparable / Visibility-Changed:** ${diff.incomparable.length}`
    ];

    if (diff.regressions.length > 0) {
      lines.push('', '**Regressed Scenarios:**');
      for (const r of diff.regressions) {
        lines.push(`- \`${r.scenarioId}\`: \`${r.before}\` -> \`${r.after}\``);
      }
    }
    if (diff.improvements.length > 0) {
      lines.push('', '**Verified Improvements:**');
      for (const imp of diff.improvements) {
        lines.push(`- \`${imp.scenarioId}\`: \`${imp.before}\` -> \`${imp.after}\``);
      }
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return { compared: true, ...diff };
  }
};

export const reportAliasCommand = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('View or regenerate a private security observation report.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('observation_id')
        .setDescription('Optional Observation ID (defaults to latest run)')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    return observeReportCommand.execute(interaction, context);
  }
};
