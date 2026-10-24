import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPlatformApp } from '../../src/index.js';
import { defineScenario } from '../../src/scenarios/schema.js';
import {
  ASSESSMENT_STATES,
  DEFAULT_OPERATOR_ID,
  OVERALL_OBSERVATION_STATUSES,
  RISK_CATEGORIES,
  SCENARIO_CATEGORIES,
  SCENARIO_RESULTS
} from '../../src/utils/constants.js';
import {
  createMockCommandInteraction,
  createMockDiscordClient,
  createMockGuild,
  makeTestEnv
} from '../helpers/mockDiscord.js';

const UNAUTHORIZED_USER_ID = '888888888888888888';

test('Emergency /stop under load: unauthorized /stop does nothing; concurrent authorized /stop calls cancel immediately', async () => {
  const client = createMockDiscordClient();
  const app = createPlatformApp({
    env: makeTestEnv({ MAX_CONCURRENT_SCENARIOS: '2' }),
    discordClient: client
  });

  try {
    // Create 8 slow multi-step scenarios (each step sleeps 250ms x 20 = 5000ms) so workflow is actively loaded
    const slowScenarios = Array.from({ length: 8 }, (_, idx) =>
      defineScenario({
        id: `SLOW-00${idx + 1}`,
        name: `slow-load-scenario-${idx + 1}`,
        title: `Slow Load Scenario ${idx + 1}`,
        description: 'Long-running cancellable simulation for /stop load testing.',
        category: SCENARIO_CATEGORIES.TIMING_CORRELATION,
        riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
        affectedCapability: 'Cancellation Under Load',
        preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
        parameters: { stepCount: 20, intervalMs: 250 },
        expectedOutcome: { maliciousStimulus: false },
        eventSequence: [
          { eventType: 'SLOW_SIMULATED_STEP', countParam: 'stepCount', isMaliciousStimulus: false }
        ],
        assertions: [
          {
            id: 'DONE',
            targetFacing: false,
            description: 'Done',
            evaluate: () => ({ status: SCENARIO_RESULTS.PASS, expected: 'ok', observed: 'ok', message: 'ok' })
          }
        ]
      })
    );

    const runPromise = app.observationWorkflow.run({
      guildOverride: createMockGuild(),
      scenariosOverride: slowScenarios
    });

    // Wait briefly until scenarios are actively running & queued
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(app.taskManager.getStatusSnapshot().activeRunCount, 1);

    // 1. Unauthorized user attempts /stop -> MUST NOT affect active run!
    const unauthStop = createMockCommandInteraction({
      commandName: 'stop',
      userId: UNAUTHORIZED_USER_ID
    });
    const unauthRes = await app.interactionRouter.handleInteraction(unauthStop);
    assert.equal(unauthRes.authorized, false);
    assert.equal(app.taskManager.getStatusSnapshot().activeRunCount, 1, 'Active run must survive unauthorized /stop');

    // 2. Fire 3 simultaneous authorized /stop commands concurrently!
    const stopStart = Date.now();
    const [stop1, stop2, stop3] = await Promise.all([
      app.interactionRouter.handleInteraction(
        createMockCommandInteraction({ commandName: 'stop', userId: DEFAULT_OPERATOR_ID })
      ),
      app.interactionRouter.handleInteraction(
        createMockCommandInteraction({ commandName: 'stop', userId: DEFAULT_OPERATOR_ID })
      ),
      app.interactionRouter.handleInteraction(
        createMockCommandInteraction({ commandName: 'stop', userId: DEFAULT_OPERATOR_ID })
      )
    ]);
    const stopElapsedMs = Date.now() - stopStart;

    assert.equal(stop1.stopped, true);
    assert.equal(stop2.stopped, true);
    assert.equal(stop3.stopped, true);
    assert.ok(stopElapsedMs < 500, `/stop must respond immediately (<500ms, actual=${stopElapsedMs}ms)`);

    const finalWorkflow = await runPromise;
    assert.equal(finalWorkflow.overallStatus, OVERALL_OBSERVATION_STATUSES.CANCELLED);
    assert.equal(app.taskManager.getStatusSnapshot().activeRunCount, 0);

    // Verify all unfinished scenarios were marked CANCELLED in SQLite
    const execs = app.repositories.listScenarioExecutionsByObservation(finalWorkflow.observationId);
    assert.equal(execs.length, 8);
    assert.ok(execs.every((e) => e.final_result === SCENARIO_RESULTS.CANCELLED));
  } finally {
    await app.shutdown('TEST_DONE');
  }
});

test('TaskManager reports incomplete cleanup honestly when a cleanup hook exceeds bounded timeout', async () => {
  const app = createPlatformApp({
    env: makeTestEnv(),
    discordClient: createMockDiscordClient()
  });
  app.taskManager.cleanupTimeoutMs = 40; // Tight 40ms cleanup bound for test speed

  try {
    const obsId = app.repositories.createObservationRun({
      operatorId: DEFAULT_OPERATOR_ID
    });
    app.taskManager.registerRun(obsId);
    app.taskManager.registerCleanupHook(
      obsId,
      'stalled_cleanup_hook',
      () => new Promise((resolve) => setTimeout(resolve, 400))
    );

    const stopRes = await app.taskManager.stopAll({ reason: 'Test bounded cleanup timeout' });
    assert.equal(stopRes.stopped, true);
    assert.equal(stopRes.incompleteCleanups.length, 1);
    assert.equal(stopRes.incompleteCleanups[0].hookId, 'stalled_cleanup_hook');

    const cleanupRows = app.repositories.listCleanupRecords({ observationId: obsId });
    assert.equal(cleanupRows[0].status, 'INCOMPLETE');
    assert.equal(cleanupRows[0].incompleteActions.length, 1);
  } finally {
    await app.shutdown('TEST_DONE');
  }
});

test('Process restart behavior marks unfinished runs INTERRUPTED_BY_RESTART and never auto-resumes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tkbn-restart-test-'));
  const dbPath = path.join(tmpDir, 'restart.sqlite');

  // Instance 1 creates an active RUNNING observation + RUNNING scenario execution, then simulates abrupt crash (close DB)
  const app1 = createPlatformApp({
    env: makeTestEnv({ DATABASE_PATH: dbPath }),
    discordClient: createMockDiscordClient()
  });

  const crashedObsId = app1.repositories.createObservationRun({
    operatorId: DEFAULT_OPERATOR_ID
  });
  app1.repositories.updateObservationRun(crashedObsId, {
    overallStatus: OVERALL_OBSERVATION_STATUSES.RUNNING
  });
  const crashedExecId = app1.repositories.insertScenarioExecution({
    observationId: crashedObsId,
    scenarioId: 'ED-001',
    scenarioVersion: '1.0.0',
    category: SCENARIO_CATEGORIES.EVENT_DETECTION,
    riskCategory: RISK_CATEGORIES.NON_DESTRUCTIVE_SIMULATION,
    state: 'RUNNING',
    finalResult: 'INCONCLUSIVE'
  });
  app1.db.close();

  // Instance 2 boots against the same SQLite file
  const app2 = createPlatformApp({
    env: makeTestEnv({ DATABASE_PATH: dbPath }),
    discordClient: createMockDiscordClient()
  });

  try {
    assert.equal(app2.startupHygiene.reconciledRuns, 1);
    assert.equal(app2.startupHygiene.reconciledExecutions, 1);
    assert.equal(app2.taskManager.getStatusSnapshot().activeRunCount, 0, 'Must NEVER auto-resume');

    const reconciledRun = app2.repositories.getObservationRun(crashedObsId);
    assert.equal(reconciledRun.overall_status, OVERALL_OBSERVATION_STATUSES.INTERRUPTED_BY_RESTART);
    assert.ok(reconciledRun.completed_at);

    const reconciledExec = app2.repositories.getScenarioExecution(crashedExecId);
    assert.equal(reconciledExec.state, 'CANCELLED');
    assert.equal(reconciledExec.final_result, SCENARIO_RESULTS.CANCELLED);
  } finally {
    await app2.shutdown('TEST_DONE');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Regression comparison and Part-10 READY_FOR_APPROVAL revalidation enforce strict scope & guild allowlist', async () => {
  const astraBotId = '998877665544332211';
  const allowlistedGuildId = '777777777777777777';
  const unallowlistedGuildId = '666666666666666666';

  const app = createPlatformApp({
    env: makeTestEnv({
      ASTRA_ASTRA_BOT_ID: astraBotId,
      DEV_GUILD_ID: allowlistedGuildId,
      TEST_GUILD_ALLOWLIST: allowlistedGuildId
    }),
    discordClient: createMockDiscordClient()
  });

  try {
    // 1. Run in UNALLOWLISTED guild -> must NOT be READY_FOR_APPROVAL!
    const unallowedOutcome = await app.observationWorkflow.run({
      guildOverride: createMockGuild({
        id: unallowlistedGuildId,
        installedBots: [{ id: astraBotId, username: 'Astra Astra' }]
      })
    });
    assert.equal(unallowedOutcome.assessmentState, ASSESSMENT_STATES.NOT_ELIGIBLE);

    const nukeDenied = await app.interactionRouter.handleInteraction(
      createMockCommandInteraction({
        commandName: 'nuke',
        userId: DEFAULT_OPERATOR_ID,
        stringOptions: { action: 'approve', observation_id: unallowedOutcome.observationId }
      })
    );
    assert.equal(nukeDenied.approved, false);

    // 2. Run in ALLOWLISTED guild with verified target -> READY_FOR_APPROVAL!
    const allowedOutcome = await app.observationWorkflow.run({
      guildOverride: createMockGuild({
        id: allowlistedGuildId,
        installedBots: [{ id: astraBotId, username: 'Astra Astra' }]
      })
    });
    assert.equal(allowedOutcome.assessmentState, ASSESSMENT_STATES.READY_FOR_APPROVAL);

    // Approve via /nuke action=approve -> revalidates all 8 safeguards and transitions to APPROVED_SINGLE_RUN
    const nukeApproved = await app.interactionRouter.handleInteraction(
      createMockCommandInteraction({
        commandName: 'nuke',
        userId: DEFAULT_OPERATOR_ID,
        stringOptions: { action: 'approve', observation_id: allowedOutcome.observationId }
      })
    );
    assert.equal(nukeApproved.approved, true);
    assert.ok(nukeApproved.scopeFingerprint);

    // Second attempt to reuse the same single-run approval is rejected because state is now APPROVED_SINGLE_RUN
    const secondAttempt = await app.interactionRouter.handleInteraction(
      createMockCommandInteraction({
        commandName: 'nuke',
        userId: DEFAULT_OPERATOR_ID,
        stringOptions: { action: 'approve', observation_id: allowedOutcome.observationId }
      })
    );
    assert.equal(secondAttempt.approved, false);

    // Compare the two runs via /observe-compare
    const compareRes = await app.interactionRouter.handleInteraction(
      createMockCommandInteraction({
        commandName: 'observe-compare',
        userId: DEFAULT_OPERATOR_ID,
        stringOptions: {
          older_id: unallowedOutcome.observationId,
          newer_id: allowedOutcome.observationId
        }
      })
    );
    assert.equal(compareRes.compared, true);
    assert.equal(compareRes.unchangedCount, 38);
  } finally {
    await app.shutdown('TEST_DONE');
  }
});
