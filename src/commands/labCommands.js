import { SlashCommandBuilder } from 'discord.js';
import { replyEphemeral } from '../interactions/respond.js';
import {
  SCENARIO_CATALOG,
  getScenarioById,
  listScenariosByCategory
} from '../scenarios/catalog/index.js';
import {
  ASSESSMENT_STATES,
  CREATOR_ATTRIBUTION,
  SCENARIO_CATEGORIES
} from '../utils/constants.js';

export const labScenariosCommand = {
  data: new SlashCommandBuilder()
    .setName('lab-scenarios')
    .setDescription('List all implemented defensive evaluation scenarios.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('category')
        .setDescription('Optional scenario category filter')
        .addChoices(
          { name: 'A. Event Detection', value: SCENARIO_CATEGORIES.EVENT_DETECTION },
          { name: 'B. Timing & Correlation', value: SCENARIO_CATEGORIES.TIMING_CORRELATION },
          { name: 'C. Reliability', value: SCENARIO_CATEGORIES.RELIABILITY },
          { name: 'D. False-Positive Resistance', value: SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE },
          { name: 'E. Incident Response', value: SCENARIO_CATEGORIES.INCIDENT_RESPONSE }
        )
        .setRequired(false)
    ),

  async execute(interaction) {
    const category = interaction.options?.getString?.('category') || null;
    const scenarios = listScenariosByCategory(category);

    const lines = [
      `**TANVEER KA BETA NEWKER — SCENARIO LIBRARY (${scenarios.length}/${SCENARIO_CATALOG.length})**`,
      category ? `Category Filter: \`${category}\`` : 'Showing all 5 defensive categories',
      ''
    ];

    for (const s of scenarios) {
      lines.push(
        `- \`${s.id}@${s.version}\` [**${s.category}**] — **${s.title}** (_${s.affectedCapability}_, timeout=${s.timeoutMs}ms)`
      );
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return { count: scenarios.length };
  }
};

export const labStatusCommand = {
  data: new SlashCommandBuilder()
    .setName('lab-status')
    .setDescription('Show active simulation jobs, worker concurrency, and queue status.')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    const snapshot = context.taskManager.getStatusSnapshot();
    const lines = [
      '**TANVEER KA BETA NEWKER — SIMULATION LABORATORY STATUS**',
      `- **Simulation Mode:** \`${context.config.simulationMode}\``,
      `- **Max Concurrent Scenarios:** ${snapshot.maxConcurrentScenarios}`,
      `- **Max Observation Duration:** ${Math.round(snapshot.maxObservationDurationMs / 60000)} min`,
      `- **Active Lab / Observation Jobs:** ${snapshot.activeRunCount}`
    ];

    if (snapshot.runs.length === 0) {
      lines.push('', 'No simulation jobs are currently active.');
    } else {
      lines.push('', '**Active Jobs:**');
      for (const r of snapshot.runs) {
        lines.push(
          `- \`${r.observationId}\` | Active: ${r.activeExecutionCount} | Queued: ${r.queuedScenarioCount} | Halted: ${r.schedulingHalted}`
        );
      }
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return snapshot;
  }
};

export const labReportCommand = {
  data: new SlashCommandBuilder()
    .setName('lab-report')
    .setDescription('Display detailed scenario execution outcomes and assertion breakdowns.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('observation_id')
        .setDescription('Optional Observation ID (defaults to latest run)')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    const obsId =
      interaction.options?.getString?.('observation_id') ||
      context.repositories.getLatestObservationRun()?.observation_id ||
      null;

    if (!obsId) {
      await replyEphemeral(interaction, 'No scenario executions found yet. Run `/observe` first.');
      return { found: false };
    }

    const executions = context.repositories.listScenarioExecutionsByObservation(obsId);
    const lines = [
      `**TANVEER KA BETA NEWKER — LAB SCENARIO RESULTS (\`${obsId}\`)**`,
      `Total Scenario Records: **${executions.length}**`,
      ''
    ];

    for (const ex of executions) {
      lines.push(
        `- \`${ex.scenario_id}@${ex.scenario_version}\` (\`${ex.execution_id}\`) -> **${ex.final_result}** [state=\`${ex.state}\`, ${ex.duration_ms ?? 0}ms]`
      );
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return { found: true, observationId: obsId, executionCount: executions.length };
  }
};

export const labReplayCommand = {
  data: new SlashCommandBuilder()
    .setName('lab-replay')
    .setDescription('Replay a completed simulation execution with identical parameters.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('execution_id')
        .setDescription('Execution ID to replay (defaults to most recent execution)')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    let executionId = interaction.options?.getString?.('execution_id') || null;
    if (!executionId) {
      const latestRun = context.repositories.getLatestObservationRun();
      if (latestRun) {
        const execs = context.repositories.listScenarioExecutionsByObservation(
          latestRun.observation_id
        );
        executionId = execs.find((e) => e.final_result !== 'BLOCKED')?.execution_id || execs[0]?.execution_id || null;
      }
    }

    if (!executionId) {
      await replyEphemeral(interaction, 'No prior scenario execution found to replay.');
      return { replayed: false };
    }

    const telemetry = await context.astraAdapter.collectTelemetry();
    const replay = await context.scenarioEngine.replayExecution({
      executionId,
      operatorId: interaction.user.id,
      targetTelemetryEvents: telemetry.events,
      telemetryAvailable: telemetry.available
    });

    const lines = [
      '**TANVEER KA BETA NEWKER — LAB SIMULATION REPLAY**',
      `- **Original Execution ID:** \`${replay.originalExecutionId}\``,
      `- **Replay Observation ID:** \`${replay.replayObservationId}\``,
      `- **Scenario:** \`${replay.replayResult?.scenarioId}@${replay.replayResult?.scenarioVersion}\``,
      `- **Replay Result:** \`${replay.replayResult?.finalResult}\` (${replay.replayResult?.durationMs ?? 0}ms)`,
      '',
      `_${CREATOR_ATTRIBUTION}_`
    ];

    await replyEphemeral(interaction, lines.join('\n'));
    return { replayed: true, ...replay };
  }
};

export const labCleanupCommand = {
  data: new SlashCommandBuilder()
    .setName('lab-cleanup')
    .setDescription('Review post-simulation cleanup verification records.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('observation_id')
        .setDescription('Optional Observation ID filter')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    const obsId = interaction.options?.getString?.('observation_id') || null;
    const records = context.repositories.listCleanupRecords({ observationId: obsId, limit: 25 });

    const lines = [
      `**TANVEER KA BETA NEWKER — CLEANUP AUDIT (${records.length} record(s))**`,
      ''
    ];

    if (records.length === 0) {
      lines.push('No cleanup records found.');
    } else {
      for (const c of records) {
        lines.push(
          `- \`${c.cleanup_id}\` | Obs: \`${c.observation_id}\` | Scenario: \`${c.scenario_id || 'RUN'}\` | Status: **${c.status}** | Incomplete: ${c.incompleteActions.length}`
        );
      }
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return { count: records.length };
  }
};

export const labOverviewCommand = {
  data: new SlashCommandBuilder()
    .setName('lab')
    .setDescription('Simulation laboratory overview (catalog, active status, cleanup summary).')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    const taskSnap = context.taskManager.getStatusSnapshot();
    const cleanups = context.repositories.listCleanupRecords({ limit: 20 });
    const incomplete = cleanups.filter((c) => c.incompleteActions.length > 0).length;

    const lines = [
      '**TANVEER KA BETA NEWKER — SIMULATION LABORATORY**',
      `- **Registered Versioned Scenarios:** ${SCENARIO_CATALOG.length}`,
      `- **Simulation Mode Enforced:** \`${context.config.simulationMode}\``,
      `- **Active Simulation Runs:** ${taskSnap.activeRunCount}`,
      `- **Recent Cleanup Verifications:** ${cleanups.length} (${incomplete} incomplete)`,
      '',
      'Sub-commands: `/lab-scenarios`, `/lab-status`, `/lab-report`, `/lab-replay`, `/lab-cleanup`',
      '',
      `_${CREATOR_ATTRIBUTION}_`
    ];

    await replyEphemeral(interaction, lines.join('\n'));
    return { catalogSize: SCENARIO_CATALOG.length, activeRunCount: taskSnap.activeRunCount };
  }
};

export const nukeGateCommand = {
  data: new SlashCommandBuilder()
    .setName('nuke')
    .setDescription(
      'Controlled anti-nuke simulation approval gate (non-destructive; requires READY_FOR_APPROVAL).'
    )
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('action')
        .setDescription('Inspect eligibility or revalidate approval for a READY_FOR_APPROVAL run')
        .addChoices(
          { name: 'Check Approval Gate Status', value: 'status' },
          { name: 'Revalidate & Approve Controlled Simulation', value: 'approve' }
        )
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('observation_id')
        .setDescription('Target Observation ID (defaults to latest run)')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    const action = interaction.options?.getString?.('action') || 'status';
    const requestedId = interaction.options?.getString?.('observation_id') || null;
    const run = requestedId
      ? context.repositories.getObservationRun(requestedId)
      : context.repositories.getLatestObservationRun();

    if (!run) {
      await replyEphemeral(
        interaction,
        'No observation assessment exists yet. Run `/observe` first; controlled anti-nuke evaluation is never permitted without a prior observation assessment.'
      );
      return { eligible: false, approved: false };
    }

    if (action === 'status') {
      const eligible = run.assessment_state === ASSESSMENT_STATES.READY_FOR_APPROVAL;
      const lines = [
        '**TANVEER KA BETA NEWKER — CONTROLLED ANTI-NUKE APPROVAL GATE**',
        `- **Observation ID:** \`${run.observation_id}\``,
        `- **Assessment State:** \`${run.assessment_state}\``,
        `- **Eligible for Approval:** ${eligible ? 'YES' : 'NO'}`,
        `- **Scope Summary:** ${run.approvalSummary?.summaryWhatItWillDo || 'Unavailable'}`,
        `- **Real-Server Destructive Actions:** FORBIDDEN (non-destructive simulation engine only)`
      ];
      if (!eligible && Array.isArray(run.approvalSummary?.reasons)) {
        lines.push('', '**Why Approval Is Unavailable:**');
        for (const r of run.approvalSummary.reasons) {
          lines.push(`- ${r}`);
        }
      }
      lines.push('', `_${CREATOR_ATTRIBUTION}_`);
      await replyEphemeral(interaction, lines.join('\n'));
      return { eligible, approved: false, observationId: run.observation_id };
    }

    // Revalidate all 8 Part-10 safeguards before granting single-run approval
    try {
      const execRows = context.repositories.listScenarioExecutionsByObservation(run.observation_id);
      const selectedScenarios = execRows
        .filter((e) => e.selection_status === 'SELECTED')
        .map((e) => getScenarioById(e.scenario_id))
        .filter(Boolean);

      const approval = context.safetyGate.revalidateApproval({
        invokingUserId: interaction.user.id,
        observationRun: run,
        selectedScenarios,
        expectedScopeFingerprint: run.approvalSummary?.scopeFingerprint
      });

      context.repositories.updateObservationRun(run.observation_id, {
        assessmentState: ASSESSMENT_STATES.APPROVED_SINGLE_RUN
      });

      const lines = [
        '**CONTROLLED SIMULATION REVALIDATED & APPROVED (SINGLE-RUN SCOPE)**',
        `- **Observation ID:** \`${run.observation_id}\``,
        `- **Scope Fingerprint:** \`${approval.scopeFingerprint}\``,
        `- **Revalidated At:** ${approval.revalidatedAt}`,
        '- All 8 Part-10 safeguards (Operator ID, Guild Allowlist, Verified Target, Scenario Selection, Execution Limits, Cleanup Plan, /stop Mechanism, Safety Config) passed revalidation.',
        '',
        `_${CREATOR_ATTRIBUTION}_`
      ];
      await replyEphemeral(interaction, lines.join('\n'));
      return { eligible: true, approved: true, scopeFingerprint: approval.scopeFingerprint };
    } catch (safetyErr) {
      await replyEphemeral(
        interaction,
        `**Controlled Test Approval Refused:**\n${safetyErr.message}\n\n_${CREATOR_ATTRIBUTION}_`
      );
      return {
        eligible: false,
        approved: false,
        failedSafeguards: safetyErr.failedSafeguards || []
      };
    }
  }
};
