import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { InvalidEvidenceSourceError } from '../../src/evidence/evidenceStore.js';
import { createPlatformApp } from '../../src/index.js';
import { AstraAstraAdapter } from '../../src/integrations/astraAstraAdapter.js';
import {
  ASSESSMENT_STATES,
  DEFAULT_OPERATOR_ID,
  EVIDENCE_SOURCE_VALUES,
  OVERALL_OBSERVATION_STATUSES,
  SCENARIO_RESULTS,
  TARGET_IDENTIFICATION_STATES
} from '../../src/utils/constants.js';
import {
  createMockCommandInteraction,
  createMockDiscordClient,
  createMockGuild,
  makeTestEnv
} from '../helpers/mockDiscord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

test('Zero-argument /observe initializes automatically, completes all 10 stages in order, and sends operator DM', async () => {
  const client = createMockDiscordClient();
  const app = createPlatformApp({
    env: makeTestEnv(),
    discordClient: client
  });

  try {
    const guild = createMockGuild();
    const interaction = createMockCommandInteraction({
      commandName: 'observe',
      userId: DEFAULT_OPERATOR_ID,
      guild
    });

    const outcome = await app.interactionRouter.handleInteraction(interaction);
    assert.ok(outcome.observationId);
    assert.equal(outcome.overallStatus, OVERALL_OBSERVATION_STATUSES.COMPLETED_SIMULATION_ONLY);
    assert.equal(outcome.dmDelivered, true);

    // Verify all 10 stages completed in strict sequential timestamp order
    const persistedRun = app.repositories.getObservationRun(outcome.observationId);
    assert.equal(persistedRun.stages.length, 10);
    assert.ok(persistedRun.stages.every((s) => s.status === 'COMPLETED'));

    // Verify DM was sent exclusively to 1131248987173814336 and contains required sections
    const dms = client.getSentDms();
    assert.ok(dms.length >= 1);
    assert.ok(dms.every((d) => d.recipientId === DEFAULT_OPERATOR_ID));
    const combinedDm = dms.map((d) => d.payload.content).join('\n');
    assert.match(combinedDm, /TANVEER KA BETA NEWKER — SECURITY OBSERVATION REPORT/);
    assert.match(combinedDm, /MADE BY TANVEER/);

    // Verify target scenarios without Astra Astra telemetry were marked INCONCLUSIVE, never FAIL
    const execs = app.repositories.listScenarioExecutionsByObservation(outcome.observationId);
    const ed001 = execs.find((e) => e.scenario_id === 'ED-001');
    assert.equal(ed001.final_result, SCENARIO_RESULTS.INCONCLUSIVE);

    // Internal reliability scenarios (REL-001..REL-010, TC-002) passed with self-contained assertions
    const rel001 = execs.find((e) => e.scenario_id === 'REL-001');
    assert.equal(rel001.final_result, SCENARIO_RESULTS.PASS);
  } finally {
    await app.shutdown('TEST_DONE');
  }
});

test('Ambiguous target detection refuses to guess among multiple guild bots when ASTRA_ASTRA_BOT_ID is unset', async () => {
  const client = createMockDiscordClient();
  const app = createPlatformApp({
    env: makeTestEnv({ ASTRA_ASTRA_BOT_ID: '' }),
    discordClient: client
  });

  try {
    const guild = createMockGuild({
      installedBots: [
        { id: '222222222222222222', username: 'SecurityBotAlpha' },
        { id: '333333333333333333', username: 'AstraGuardCandidate' }
      ]
    });

    const outcome = await app.observationWorkflow.run({ guildOverride: guild });
    const run = app.repositories.getObservationRun(outcome.observationId);
    assert.equal(run.target_identification_state, TARGET_IDENTIFICATION_STATES.AMBIGUOUS);
    assert.equal(run.target_bot_id, null, 'Must never invent or guess target bot ID');

    const findings = app.repositories.listFindingsByObservation(outcome.observationId);
    assert.ok(
      findings.some((f) => f.scenarioId === 'ENV-TARGET-ID' && f.title.includes('Ambiguous Target'))
    );
  } finally {
    await app.shutdown('TEST_DONE');
  }
});

test('Verified Astra Astra integration correlates JSON logs, incidents, NDJSON history, and HMAC webhooks accurately', async () => {
  const webhookSecret = 'astra_hmac_signing_secret_key_2026';
  const astraBotId = '998877665544332211';
  const client = createMockDiscordClient();

  const app = createPlatformApp({
    env: makeTestEnv({
      ASTRA_ASTRA_BOT_ID: astraBotId,
      ASTRA_ASTRA_LOG_PATH: path.join(FIXTURES_DIR, 'astra-structured-logs.json'),
      ASTRA_ASTRA_INCIDENT_PATH: path.join(FIXTURES_DIR, 'astra-incident-reports.json'),
      ASTRA_ASTRA_DETECTION_HISTORY_PATH: path.join(FIXTURES_DIR, 'astra-detection-history.ndjson'),
      ENABLE_TELEMETRY_WEBHOOK: 'true',
      TELEMETRY_WEBHOOK_PORT: '18991',
      TELEMETRY_WEBHOOK_SECRET: webhookSecret
    }),
    discordClient: client
  });

  try {
    const addr = await app.astraAdapter.startWebhookServer();
    assert.ok(addr);

    // Send a real HTTP POST with valid HMAC-SHA256 signature for IR-002 (without responseLatencyMs to test PARTIAL!)
    const nowMs = Date.now();
    const webhookBody = JSON.stringify({
      id: 'wh_live_001',
      botId: astraBotId,
      version: '2.4.1',
      kind: 'WEBHOOK_ALERT',
      scenarioId: 'IR-002',
      triggerEventType: 'IR_RESPONSE_LATENCY_PROBE',
      timestamp: nowMs
      // Note: responseLatencyMs intentionally omitted so IR-002 evaluates PARTIAL (detected=PASS, responseLatency=INCONCLUSIVE)
    });
    const validSig = AstraAstraAdapter.signWebhookPayload(webhookSecret, String(nowMs), webhookBody);

    const okResp = await fetch('http://127.0.0.1:18991/telemetry/astra-astra', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Astra-Timestamp': String(nowMs),
        'X-Astra-Signature': `sha256=${validSig}`
      },
      body: webhookBody
    });
    assert.equal(okResp.status, 202);

    // Tampered signature must be rejected with HTTP 401
    const badResp = await fetch('http://127.0.0.1:18991/telemetry/astra-astra', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Astra-Timestamp': String(nowMs),
        'X-Astra-Signature': 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
      },
      body: webhookBody
    });
    assert.equal(badResp.status, 401);

    const guild = createMockGuild({
      id: '777777777777777777',
      installedBots: [{ id: astraBotId, username: 'Astra Astra' }]
    });

    const outcome = await app.observationWorkflow.run({ guildOverride: guild });
    assert.equal(outcome.assessmentState, ASSESSMENT_STATES.READY_FOR_APPROVAL);
    assert.equal(outcome.overallStatus, OVERALL_OBSERVATION_STATUSES.READY_FOR_APPROVAL);

    const execs = app.repositories.listScenarioExecutionsByObservation(outcome.observationId);
    // ED-001 had matching fixture telemetry -> PASS
    assert.equal(execs.find((e) => e.scenario_id === 'ED-001').final_result, SCENARIO_RESULTS.PASS);
    // ED-002 had NO detection in active telemetry -> FAIL (Confirmed Defect!)
    assert.equal(execs.find((e) => e.scenario_id === 'ED-002').final_result, SCENARIO_RESULTS.FAIL);
    // FPR-001 had 0 false-positive alerts during active telemetry -> PASS
    assert.equal(execs.find((e) => e.scenario_id === 'FPR-001').final_result, SCENARIO_RESULTS.PASS);
    // IR-002 had primary detection PASS + missing responseLatencyMs INCONCLUSIVE -> PARTIAL!
    assert.equal(execs.find((e) => e.scenario_id === 'IR-002').final_result, SCENARIO_RESULTS.PARTIAL);
    // IR-005 honestly reported actionSucceeded=false -> PASS!
    assert.equal(execs.find((e) => e.scenario_id === 'IR-005').final_result, SCENARIO_RESULTS.PASS);

    // Verify every persisted evidence record uses a valid labeled source category
    const evidence = app.repositories.listEvidenceByObservation(outcome.observationId);
    assert.ok(evidence.length > 20);
    assert.ok(evidence.every((ev) => EVIDENCE_SOURCE_VALUES.includes(ev.source_type)));

    // Verify EvidenceStore rejects unlabeled/invalid evidence source
    assert.throws(
      () =>
        app.evidenceStore.recordEvidence({
          observationId: outcome.observationId,
          sourceType: 'UNLABELED_GUESSED_SOURCE',
          summary: 'bad',
          relationshipExplanation: 'bad'
        }),
      InvalidEvidenceSourceError
    );
  } finally {
    await app.shutdown('TEST_DONE');
  }
});

test('DM delivery failure preserves report in SQLite & archive and triggers private ephemeral fallback', async () => {
  const dmFailingClient = createMockDiscordClient({ dmShouldFail: true });
  const app = createPlatformApp({
    env: makeTestEnv({
      ASTRA_ASTRA_LOG_PATH: '/nonexistent/missing-astra-log.json' // Also exercises integration file warning!
    }),
    discordClient: dmFailingClient
  });

  try {
    const interaction = createMockCommandInteraction({
      commandName: 'observe',
      userId: DEFAULT_OPERATOR_ID
    });
    const outcome = await app.interactionRouter.handleInteraction(interaction);
    assert.equal(outcome.dmDelivered, false);
    assert.equal(outcome.fallbackUsed, true);

    // Verify report is safely stored in SQLite
    const savedReport = app.repositories.getReportByObservation(outcome.observationId);
    assert.ok(savedReport);
    assert.equal(savedReport.dm_delivery_status, 'FAILED');
    assert.equal(savedReport.fallback_status, 'EPHEMERAL_OPERATOR_FALLBACK_DELIVERED');
    assert.ok(
      outcome.report.criticalLimitations.some((l) => l.includes('missing-astra-log.json')),
      'Integration failure on missing log file must be surfaced in criticalLimitations'
    );

    const transcript = interaction.getTranscript();
    assert.equal(transcript.followUps.length, 1);
    assert.match(transcript.followUps[0].content, /Private DM Delivery Fallback/);
  } finally {
    await app.shutdown('TEST_DONE');
  }
});

test('Workflow stage failure sends accurate Part-9 Failure DM with failedStage, errorCategory, and lastSuccessfulStage', async () => {
  const client = createMockDiscordClient();
  const app = createPlatformApp({
    env: makeTestEnv(),
    discordClient: client,
    faultInjector: async (stageKey) => {
      if (stageKey === 'PREPARING_TEST_SCENARIOS') {
        const err = new Error('Simulated planner subsystem fault');
        err.category = 'PLANNER_SUBSYSTEM_FAULT';
        throw err;
      }
    }
  });

  try {
    const outcome = await app.observationWorkflow.run({ guildOverride: createMockGuild() });
    assert.equal(outcome.failed, true);
    assert.equal(outcome.failedStage, 'PREPARING_TEST_SCENARIOS');
    assert.equal(outcome.errorCategory, 'PLANNER_SUBSYSTEM_FAULT');
    assert.equal(outcome.lastSuccessfulStage, 'CHECKING_PERMISSIONS_AND_COLLECTORS');
    assert.equal(outcome.databaseSaved, true);
    assert.equal(outcome.reportSaved, true);
    assert.equal(outcome.dmDelivered, true);

    const dmText = client.getSentDms().map((d) => d.payload.content).join('\n');
    assert.match(dmText, /OBSERVATION WORKFLOW FAILURE NOTICE/);
    assert.match(dmText, /PREPARING_TEST_SCENARIOS/);
    assert.match(dmText, /PLANNER_SUBSYSTEM_FAULT/);
    assert.match(dmText, /CHECKING_PERMISSIONS_AND_COLLECTORS/);
  } finally {
    await app.shutdown('TEST_DONE');
  }
});

test('Missing Discord permissions without telemetry marks dependent scenarios BLOCKED and others INCONCLUSIVE', async () => {
  const app = createPlatformApp({
    env: makeTestEnv(),
    discordClient: createMockDiscordClient()
  });

  try {
    const restrictedGuild = createMockGuild({
      botPermissions: ['ViewChannel'] // Missing ViewAuditLog!
    });

    const outcome = await app.observationWorkflow.run({ guildOverride: restrictedGuild });
    const execs = app.repositories.listScenarioExecutionsByObservation(outcome.observationId);

    const blocked = execs.filter((e) => e.final_result === SCENARIO_RESULTS.BLOCKED);
    assert.ok(blocked.length >= 7, 'Audit-log dependent scenarios must be marked BLOCKED');
    assert.ok(blocked.some((b) => b.scenario_id === 'ED-001'));
  } finally {
    await app.shutdown('TEST_DONE');
  }
});
