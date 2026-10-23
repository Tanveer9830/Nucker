import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sha256Hex } from '../utils/ids.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export class DatabaseError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'DatabaseError';
    if (cause) this.cause = cause;
  }
}

export class DatabaseManager {
  constructor({
    databasePath = ':memory:',
    migrationsDir = DEFAULT_MIGRATIONS_DIR,
    logger = null
  } = {}) {
    this.databasePath = databasePath;
    this.migrationsDir = migrationsDir;
    this.logger = logger;
    this.db = null;
    this._txDepth = 0;
  }

  open() {
    if (this.db) {
      return this;
    }

    try {
      if (this.databasePath !== ':memory:') {
        const dir = path.dirname(this.databasePath);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      this.db = new DatabaseSync(this.databasePath);
      if (this.databasePath !== ':memory:' && fs.existsSync(this.databasePath)) {
        try {
          fs.chmodSync(this.databasePath, 0o600);
        } catch {
          // Non-fatal on filesystems without POSIX chmod
        }
      }

      this.db.exec('PRAGMA foreign_keys = ON;');
      this.db.exec('PRAGMA busy_timeout = 5000;');
      if (this.databasePath !== ':memory:') {
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');
      }

      return this;
    } catch (error) {
      throw new DatabaseError(`Failed to open SQLite database at "${this.databasePath}": ${error.message}`, error);
    }
  }

  ensureOpen() {
    if (!this.db) {
      throw new DatabaseError('SQLite database connection is not open.');
    }
  }

  run(sql, ...params) {
    this.ensureOpen();
    try {
      return this.db.prepare(sql).run(...params);
    } catch (error) {
      throw new DatabaseError(`SQLite write failed: ${error.message}`, error);
    }
  }

  get(sql, ...params) {
    this.ensureOpen();
    try {
      const row = this.db.prepare(sql).get(...params);
      return row ? { ...row } : null;
    } catch (error) {
      throw new DatabaseError(`SQLite get query failed: ${error.message}`, error);
    }
  }

  all(sql, ...params) {
    this.ensureOpen();
    try {
      const rows = this.db.prepare(sql).all(...params);
      return rows.map((row) => ({ ...row }));
    } catch (error) {
      throw new DatabaseError(`SQLite all query failed: ${error.message}`, error);
    }
  }

  transaction(fn) {
    this.ensureOpen();
    const depth = this._txDepth;
    const savepointName = `sp_${depth}`;
    this._txDepth += 1;

    try {
      if (depth === 0) {
        this.db.exec('BEGIN IMMEDIATE;');
      } else {
        this.db.exec(`SAVEPOINT ${savepointName};`);
      }

      const result = fn(this);

      if (depth === 0) {
        this.db.exec('COMMIT;');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }
      return result;
    } catch (error) {
      try {
        if (depth === 0) {
          this.db.exec('ROLLBACK;');
        } else {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
          this.db.exec(`RELEASE SAVEPOINT ${savepointName};`);
        }
      } catch {
        // Ignore rollback secondary failure
      }
      throw error instanceof DatabaseError
        ? error
        : new DatabaseError(`Transaction aborted: ${error.message}`, error);
    } finally {
      this._txDepth = depth;
    }
  }

  runMigrations() {
    this.open();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const appliedNow = [];

    for (const file of files) {
      const fullPath = path.join(this.migrationsDir, file);
      const sqlContent = fs.readFileSync(fullPath, 'utf8');
      const checksum = sha256Hex(sqlContent);

      const existing = this.get(
        'SELECT migration_name, checksum FROM schema_migrations WHERE migration_name = ?',
        file
      );

      if (existing) {
        if (existing.checksum !== checksum) {
          throw new DatabaseError(
            `Migration checksum mismatch for "${file}" (expected ${existing.checksum}, found ${checksum}).`
          );
        }
        continue;
      }

      this.transaction(() => {
        this.db.exec(sqlContent);
        this.run(
          'INSERT INTO schema_migrations (migration_name, checksum, applied_at) VALUES (?, ?, ?)',
          file,
          checksum,
          new Date().toISOString()
        );
      });
      appliedNow.push(file);
    }

    if (appliedNow.length > 0) {
      this.logger?.info('Applied SQLite database migrations', { applied: appliedNow });
    }

    return {
      totalMigrations: files.length,
      appliedNow
    };
  }

  checkIntegrity() {
    this.ensureOpen();
    const integrityRows = this.all('PRAGMA integrity_check;');
    const fkViolationRows = this.all('PRAGMA foreign_key_check;');
    const migrationRows = this.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    );

    const integrityStatus = integrityRows[0]?.integrity_check ?? 'unknown';
    const healthy = integrityStatus === 'ok' && fkViolationRows.length === 0;

    return {
      healthy,
      integrityStatus,
      foreignKeyViolations: fkViolationRows.length,
      migrationsInitialized: migrationRows.length > 0,
      databasePath: this.databasePath
    };
  }

  backupTo(destinationPath) {
    this.ensureOpen();
    const resolvedDest = path.resolve(destinationPath);
    fs.mkdirSync(path.dirname(resolvedDest), { recursive: true, mode: 0o700 });
    if (fs.existsSync(resolvedDest)) {
      fs.unlinkSync(resolvedDest);
    }

    // Escape single quotes in file path for VACUUM INTO literal
    const escapedPath = resolvedDest.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escapedPath}';`);

    try {
      fs.chmodSync(resolvedDest, 0o600);
    } catch {
      // Non-fatal
    }

    const bytes = fs.readFileSync(resolvedDest);
    const checksum = sha256Hex(bytes.toString('base64'));
    const manifestPath = `${resolvedDest}.sha256`;
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          backupPath: resolvedDest,
          sha256Base64Digest: checksum,
          byteSize: bytes.length,
          createdAt: new Date().toISOString()
        },
        null,
        2
      ),
      { mode: 0o600 }
    );

    return {
      backupPath: resolvedDest,
      manifestPath,
      byteSize: bytes.length,
      checksum
    };
  }

  restoreFrom(backupPath) {
    if (this.databasePath === ':memory:') {
      throw new DatabaseError('Cannot restore file backup into an :memory: database path.');
    }
    const resolvedBackup = path.resolve(backupPath);
    if (!fs.existsSync(resolvedBackup)) {
      throw new DatabaseError(`Backup file does not exist: ${resolvedBackup}`);
    }

    // Verify backup integrity before modifying live database
    let probeDb = null;
    try {
      probeDb = new DatabaseSync(resolvedBackup, { readOnly: true });
      const check = probeDb.prepare('PRAGMA integrity_check;').get();
      if (!check || check.integrity_check !== 'ok') {
        throw new DatabaseError('Backup file failed SQLite integrity_check; aborting restore.');
      }
      const migTable = probeDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
        .get();
      if (!migTable) {
        throw new DatabaseError('Backup file is missing schema_migrations table; aborting restore.');
      }
    } catch (err) {
      throw err instanceof DatabaseError
        ? err
        : new DatabaseError(`Corrupt or unreadable SQLite backup file: ${err.message}`, err);
    } finally {
      if (probeDb) {
        try {
          probeDb.close();
        } catch {
          // Ignore close error on invalid handle
        }
      }
    }

    this.close();

    // Remove stale WAL/SHM files before copying restored snapshot
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${this.databasePath}${suffix}`;
      if (fs.existsSync(sidecar)) {
        fs.unlinkSync(sidecar);
      }
    }

    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(resolvedBackup, this.databasePath);
    try {
      fs.chmodSync(this.databasePath, 0o600);
    } catch {
      // Non-fatal
    }

    this.open();
    this.runMigrations();
    return this.checkIntegrity();
  }

  applyRetentionPolicy(retentionDays = 90) {
    this.ensureOpen();
    const cutoffIso = new Date(Date.now() - retentionDays * 86400 * 1000).toISOString();

    return this.transaction(() => {
      // Preserve active baseline observation runs while pruning older completed/cancelled/failed runs
      const deletedRuns = this.run(
        `DELETE FROM observation_runs
         WHERE completed_at IS NOT NULL
           AND completed_at < ?
           AND observation_id NOT IN (
             SELECT observation_id FROM regression_baselines WHERE is_active = 1
           )`,
        cutoffIso
      );

      const deletedAudits = this.run(
        'DELETE FROM authorization_audit_records WHERE created_at < ?',
        cutoffIso
      );

      const deletedConfigs = this.run(
        'DELETE FROM configuration_metadata WHERE recorded_at < ?',
        cutoffIso
      );

      return {
        cutoffIso,
        deletedObservationRuns: Number(deletedRuns.changes ?? 0),
        deletedAuditRecords: Number(deletedAudits.changes ?? 0),
        deletedConfigSnapshots: Number(deletedConfigs.changes ?? 0)
      };
    });
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } finally {
        this.db = null;
      }
    }
  }
}
