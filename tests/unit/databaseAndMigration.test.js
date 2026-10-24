import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseError, DatabaseManager } from '../../src/database/connection.js';
import { PlatformRepositories } from '../../src/database/repositories.js';
import { ReportGenerator } from '../../src/reports/generator.js';
import { DEFAULT_OPERATOR_ID } from '../../src/utils/constants.js';

test('SQLite migrations, integrity checks, atomic backup, restore recovery, and corrupt backup rejection', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tkbn-db-test-'));
  const dbPath = path.join(tmpDir, 'primary.sqlite');
  const backupPath = path.join(tmpDir, 'backups', 'snapshot.sqlite');
  const corruptPath = path.join(tmpDir, 'corrupt.sqlite');

  const db = new DatabaseManager({ databasePath: dbPath });
  try {
    db.open();
    const mig = db.runMigrations();
    assert.equal(mig.totalMigrations, 2);
    assert.equal(mig.appliedNow.length, 2);

    // Idempotent second run applies 0 new migrations
    const mig2 = db.runMigrations();
    assert.equal(mig2.appliedNow.length, 0);

    const integrity = db.checkIntegrity();
    assert.equal(integrity.healthy, true);
    assert.equal(integrity.integrityStatus, 'ok');

    const repos = new PlatformRepositories(db);
    const obsId = repos.createObservationRun({
      operatorId: DEFAULT_OPERATOR_ID,
      guildId: '777777777777777777',
      guildName: 'Backup Test Guild'
    });

    // Perform online atomic backup
    const backupInfo = db.backupTo(backupPath);
    assert.ok(fs.existsSync(backupInfo.backupPath));
    assert.ok(fs.existsSync(backupInfo.manifestPath));
    assert.ok(backupInfo.byteSize > 0);

    // Delete row in live DB, then restore from backup and verify row is recovered!
    db.run('DELETE FROM observation_runs WHERE observation_id = ?', obsId);
    assert.equal(repos.getObservationRun(obsId), null);

    const postRestoreIntegrity = db.restoreFrom(backupPath);
    assert.equal(postRestoreIntegrity.healthy, true);
    const restoredObs = repos.getObservationRun(obsId);
    assert.ok(restoredObs);
    assert.equal(restoredObs.guild_name, 'Backup Test Guild');

    // Verify restore rejects a non-SQLite / corrupt file without destroying live DB
    fs.writeFileSync(corruptPath, 'NOT_A_VALID_SQLITE_FILE_HEADER');
    assert.throws(() => db.restoreFrom(corruptPath), DatabaseError);
    assert.ok(repos.getObservationRun(obsId), 'Live database must remain intact after rejected restore');
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Data retention policy prunes expired completed runs while preserving active baseline runs', () => {
  const db = new DatabaseManager({ databasePath: ':memory:' }).open();
  db.runMigrations();
  const repos = new PlatformRepositories(db);

  const oldDate = new Date(Date.now() - 120 * 86400 * 1000).toISOString();

  // Expired ordinary completed run (should be pruned)
  const expiredObs = repos.createObservationRun({
    observationId: 'obs_expired_old',
    operatorId: DEFAULT_OPERATOR_ID,
    startedAt: oldDate
  });
  repos.updateObservationRun(expiredObs, {
    overallStatus: 'COMPLETED_SIMULATION_ONLY',
    completedAt: oldDate
  });

  // Expired run linked to active regression baseline (must be preserved!)
  const baselineObs = repos.createObservationRun({
    observationId: 'obs_active_baseline',
    operatorId: DEFAULT_OPERATOR_ID,
    guildId: '777777777777777777',
    startedAt: oldDate
  });
  repos.updateObservationRun(baselineObs, {
    overallStatus: 'COMPLETED_VERIFIED_TELEMETRY',
    completedAt: oldDate
  });
  repos.saveRegressionBaseline({
    observationId: baselineObs,
    guildId: '777777777777777777',
    scenarioOutcomes: { 'ED-001': 'PASS' }
  });

  const pruneResult = db.applyRetentionPolicy(90);
  assert.equal(pruneResult.deletedObservationRuns, 1);
  assert.equal(repos.getObservationRun(expiredObs), null);
  assert.ok(repos.getObservationRun(baselineObs), 'Active baseline run must be retained');

  db.close();
});

test('Report can be deterministically regenerated solely from persisted SQLite records without rerunning scenarios', () => {
  const db = new DatabaseManager({ databasePath: ':memory:' }).open();
  db.runMigrations();
  const repos = new PlatformRepositories(db);

  const obsId = repos.createObservationRun({
    observationId: 'obs_regen_test',
    operatorId: DEFAULT_OPERATOR_ID,
    guildId: '777777777777777777',
    guildName: 'Regeneration Lab'
  });
  repos.updateObservationRun(obsId, {
    targetBotName: 'Astra Astra',
    targetBotId: '998877665544332211',
    targetIdentificationState: 'VERIFIED',
    integrationStatus: 'VERIFIED_WITH_TELEMETRY',
    overallStatus: 'COMPLETED_VERIFIED_TELEMETRY',
    completedAt: '2026-10-24T01:00:00.000Z'
  });

  const generator = new ReportGenerator({ repositories: repos });
  const firstGen = generator.generateFromDatabase(obsId);
  const secondGen = generator.generateFromDatabase(obsId);

  assert.equal(firstGen.renderedMarkdown, secondGen.renderedMarkdown);
  assert.match(firstGen.renderedMarkdown, /TANVEER KA BETA NEWKER — SECURITY OBSERVATION REPORT/);
  assert.match(firstGen.renderedMarkdown, /MADE BY TANVEER/);
  assert.match(firstGen.renderedMarkdown, /998877665544332211/);

  db.close();
});
