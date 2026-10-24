import assert from 'node:assert/strict';
import test from 'node:test';
import { RAW_COMMAND_MODULES } from '../../src/commands/index.js';
import { createPlatformApp } from '../../src/index.js';
import { DEFAULT_OPERATOR_ID } from '../../src/utils/constants.js';
import {
  createMockCommandInteraction,
  createMockComponentInteraction,
  createMockDiscordClient,
  createMockGuild,
  makeTestEnv
} from '../helpers/mockDiscord.js';

const UNAUTHORIZED_USER_ID = '999999999999999999';

test('Central Requirement: /observe takes strictly ZERO arguments', () => {
  const observeMod = RAW_COMMAND_MODULES.find((m) => m.data.name === 'observe');
  assert.ok(observeMod, '/observe command must exist');
  const json = observeMod.data.toJSON();
  assert.equal(json.name, 'observe');
  assert.equal((json.options || []).length, 0, '/observe must define zero options');
});

test('Every single registered command rejects unauthorized users and records DENIED audit entries', async () => {
  const client = createMockDiscordClient();
  const app = createPlatformApp({
    env: makeTestEnv(),
    discordClient: client
  });

  try {
    assert.equal(app.commandRegistry.size, 27, 'All 27 operator commands must be registered');

    for (const commandName of app.commandRegistry.keys()) {
      const interaction = createMockCommandInteraction({
        commandName,
        userId: UNAUTHORIZED_USER_ID,
        // Impersonate creator username to prove usernames/display names are NEVER trusted
        username: 'MADE BY TANVEER'
      });

      const res = await app.interactionRouter.handleInteraction(interaction);
      assert.equal(res.authorized, false, `/${commandName} must reject unauthorized user`);
      assert.equal(res.denied, true, `/${commandName} must mark denied=true`);

      const transcript = interaction.getTranscript();
      assert.equal(transcript.replies.length, 1);
      assert.match(transcript.replies[0].payload.content, /Access denied/i);
    }

    // Verify no observation runs were created by any unauthorized attempt
    assert.equal(app.repositories.listObservationRuns(10).length, 0);

    // Verify all 27 denied attempts were recorded in authorization_audit_records
    const deniedAudits = app.repositories.listAuthAudits({ decision: 'DENIED', limit: 100 });
    assert.equal(deniedAudits.length, 27);
    assert.ok(deniedAudits.every((a) => a.invoking_user_id === UNAUTHORIZED_USER_ID));
  } finally {
    await app.shutdown('TEST_DONE');
  }
});

test('Buttons, select menus, and modals also enforce operator-only deny-by-default authorization', async () => {
  const app = createPlatformApp({
    env: makeTestEnv(),
    discordClient: createMockDiscordClient()
  });

  try {
    for (const [kind, customId] of [
      ['button', 'btn_emergency_stop'],
      ['button', 'btn_observe_status_refresh'],
      ['select', 'unregistered_select_menu'],
      ['modal', 'unregistered_modal_submit']
    ]) {
      const unauthComp = createMockComponentInteraction({
        customId,
        kind,
        userId: UNAUTHORIZED_USER_ID
      });
      const res = await app.interactionRouter.handleInteraction(unauthComp);
      assert.equal(res.authorized, false);
      assert.match(unauthComp.getReplies()[0].content, /Access denied/i);
    }

    // Authorized operator invoking refresh button succeeds
    const authBtn = createMockComponentInteraction({
      customId: 'btn_observe_status_refresh',
      kind: 'button',
      userId: DEFAULT_OPERATOR_ID
    });
    const okRes = await app.interactionRouter.handleInteraction(authBtn);
    assert.equal(okRes.activeRunCount, 0);
  } finally {
    await app.shutdown('TEST_DONE');
  }
});

test('Every registered command executes cleanly for the authorized operator (1131248987173814336)', async () => {
  const client = createMockDiscordClient();
  const app = createPlatformApp({
    env: makeTestEnv(),
    discordClient: client
  });

  try {
    const guild = createMockGuild();

    // First run /observe as authorized operator so history/reports/lab/security commands have real persisted data
    const obsInteraction = createMockCommandInteraction({
      commandName: 'observe',
      userId: DEFAULT_OPERATOR_ID,
      guild
    });
    const obsResult = await app.interactionRouter.handleInteraction(obsInteraction);
    assert.ok(obsResult.observationId);

    // Run a second /observe so /observe-compare has >= 2 runs
    const obsInteraction2 = createMockCommandInteraction({
      commandName: 'observe',
      userId: DEFAULT_OPERATOR_ID,
      guild
    });
    await app.interactionRouter.handleInteraction(obsInteraction2);

    // Execute all remaining 26 commands as authorized operator
    for (const commandName of app.commandRegistry.keys()) {
      if (commandName === 'observe') continue;
      const interaction = createMockCommandInteraction({
        commandName,
        userId: DEFAULT_OPERATOR_ID,
        guild
      });
      const result = await app.interactionRouter.handleInteraction(interaction);
      assert.notEqual(result?.denied, true, `/${commandName} must allow authorized operator`);
      const transcript = interaction.getTranscript();
      assert.ok(
        transcript.replies.length > 0 || transcript.edits.length > 0,
        `/${commandName} must send an ephemeral response`
      );
    }

    const allowedAudits = app.repositories.listAuthAudits({ decision: 'ALLOWED', limit: 100 });
    assert.equal(allowedAudits.length, 28); // 2 /observe + 26 other commands
  } finally {
    await app.shutdown('TEST_DONE');
  }
});
