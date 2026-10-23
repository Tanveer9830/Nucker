import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlatformApp } from '../src/index.js';
import {
  createMockDiscordClient,
  createMockGuild,
  makeTestEnv
} from '../tests/helpers/mockDiscord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const SAMPLES_DIR = path.join(ROOT, 'samples', 'reports');
const FIXTURES_DIR = path.join(ROOT, 'tests', 'fixtures');

fs.mkdirSync(SAMPLES_DIR, { recursive: true });

// 1. Standalone Simulation-Only Observation Sample
{
  const app = createPlatformApp({
    env: makeTestEnv(),
    discordClient: createMockDiscordClient()
  });
  const res = await app.observationWorkflow.run({
    guildOverride: createMockGuild({
      name: 'Astra Sandbox Server',
      id: '777777777777777777'
    })
  });
  fs.writeFileSync(
    path.join(SAMPLES_DIR, 'sample-standalone-observation.md'),
    res.renderedMarkdown
  );
  await app.shutdown('SAMPLE_GEN');
}

// 2. Verified Astra Astra Telemetry Observation Sample
{
  const astraBotId = '998877665544332211';
  const app = createPlatformApp({
    env: makeTestEnv({
      ASTRA_ASTRA_BOT_ID: astraBotId,
      ASTRA_ASTRA_LOG_PATH: path.join(FIXTURES_DIR, 'astra-structured-logs.json'),
      ASTRA_ASTRA_INCIDENT_PATH: path.join(FIXTURES_DIR, 'astra-incident-reports.json'),
      ASTRA_ASTRA_DETECTION_HISTORY_PATH: path.join(FIXTURES_DIR, 'astra-detection-history.ndjson')
    }),
    discordClient: createMockDiscordClient()
  });
  const res = await app.observationWorkflow.run({
    guildOverride: createMockGuild({
      name: 'Astra Verification Lab',
      id: '777777777777777777',
      installedBots: [{ id: astraBotId, username: 'Astra Astra' }]
    })
  });
  fs.writeFileSync(
    path.join(SAMPLES_DIR, 'sample-verified-telemetry-observation.md'),
    res.renderedMarkdown
  );
  fs.writeFileSync(
    path.join(SAMPLES_DIR, 'sample-verified-telemetry-observation.json'),
    JSON.stringify(res.report, null, 2)
  );
  await app.shutdown('SAMPLE_GEN');
}

process.stdout.write(`Generated authentic sample reports in ${SAMPLES_DIR}\n`);
