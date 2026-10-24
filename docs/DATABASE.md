# SQLite Storage, Schema, Backups & Recovery

> **Creator:** `MADE BY TANVEER`  
> **Implementation:** `src/database/connection.js`, `src/database/repositories.js`, `src/database/migrations/`

## 1. Engine & PRAGMA Configuration

Uses Node.js 22 LTS built-in `node:sqlite` (`DatabaseSync`) with:
- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- `PRAGMA synchronous = NORMAL`
- `PRAGMA busy_timeout = 5000`
- Parameterized prepared statements (`db.prepare(sql).run(...)`) across 100% of queries.
- Atomic `BEGIN IMMEDIATE ... COMMIT / ROLLBACK` transactions with nested `SAVEPOINT` support.

---

## 2. Relational Schema Overview

| Table | Primary Key | Purpose |
| --- | --- | --- |
| `schema_migrations` | `migration_name` | Tracks applied `.sql` migrations and verifies SHA-256 checksums on startup |
| `configuration_metadata` | `config_id` | Sanitized secret-free runtime configuration snapshots |
| `authorization_audit_records` | `audit_id` | Immutable `ALLOWED` / `DENIED` audit log for every command & component |
| `scenario_definitions` | `(scenario_id, version)` | Synced catalog of all 38 versioned scenarios |
| `observation_runs` | `observation_id` | Lifecycle stages, discovery metadata, status, metrics, limitations, approval gate |
| `scenario_executions` | `execution_id` | Per-scenario selection rationale, state-machine history, assertions, duration, result |
| `normalized_events` | `event_id` | Ordered event timeline with source labels, correlation keys, and duplicate flags |
| `evidence_records` | `evidence_id` | SHA-256 checksummed evidence metadata & causal relationship explanations |
| `findings` | `finding_id` | Defects, suspected weaknesses, informational observations, and remediation details |
| `reports` | `report_id` | Persisted structured JSON & Markdown reports, DM status, fallback status, archive path |
| `regression_baselines` | `baseline_id` | Active per-guild scenario outcome & metric baselines |
| `cleanup_records` | `cleanup_id` | Planned, completed, and incomplete cleanup actions per scenario/run |

---

## 3. Migrations & Integrity Verification

```bash
# Run pending SQL migrations
npm run db:migrate

# Run PRAGMA integrity_check + PRAGMA foreign_key_check
npm run db:integrity
```

If any previously applied migration file's SHA-256 checksum does not match `schema_migrations.checksum`, startup fails closed with `DatabaseError`.

---

## 4. Online Atomic Backups & Verified Restoration

### Create an Online Backup
Uses SQLite `VACUUM INTO` to produce a consistent single-file snapshot with `0600` permissions plus a `.sha256` manifest sidecar:

```bash
./scripts/backup.sh
# Or specify custom destination path:
./scripts/backup.sh ./data/backups/pre-upgrade.sqlite
```

### Restore from a Backup
`restoreFrom()` opens the candidate backup read-only first, verifies `PRAGMA integrity_check == 'ok'` and confirms `schema_migrations` exists **before** closing the live database, clearing stale `-wal`/`-shm` sidecars, copying the verified snapshot, and re-running migrations:

```bash
# Stop running service first if systemd is active:
# sudo systemctl stop tanveer-beta-newker
./scripts/restore.sh ./data/backups/pre-upgrade.sqlite
```

---

## 5. Automated Data Retention

On startup (and via `db.applyRetentionPolicy(DATA_RETENTION_DAYS)`), completed/cancelled/failed observation runs, old config snapshots, and old audit records older than `DATA_RETENTION_DAYS` (default `90` days) are pruned inside a single transaction—while **always preserving** any observation run referenced by an active `regression_baselines` record (`is_active = 1`).
