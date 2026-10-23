import path from 'node:path';
import { loadConfig } from '../config/index.js';
import { DatabaseManager } from './connection.js';

const action = process.argv[2] || 'migrate';
const argPath = process.argv[3];

try {
  const config = loadConfig({ strict: false });
  const db = new DatabaseManager({ databasePath: config.databasePath });
  db.open();

  if (action === 'migrate') {
    const res = db.runMigrations();
    const integrity = db.checkIntegrity();
    process.stdout.write(`${JSON.stringify({ action: 'migrate', ...res, integrity }, null, 2)}\n`);
  } else if (action === 'integrity') {
    const integrity = db.checkIntegrity();
    process.stdout.write(`${JSON.stringify({ action: 'integrity', ...integrity }, null, 2)}\n`);
    process.exit(integrity.healthy ? 0 : 1);
  } else if (action === 'backup') {
    db.runMigrations();
    const dest =
      argPath ||
      path.join(
        path.dirname(config.databasePath),
        'backups',
        `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`
      );
    const backupInfo = db.backupTo(dest);
    process.stdout.write(`${JSON.stringify({ action: 'backup', ...backupInfo }, null, 2)}\n`);
  } else if (action === 'restore') {
    if (!argPath) {
      throw new Error('Usage: npm run db:restore -- <path-to-backup.sqlite>');
    }
    const restoreInfo = db.restoreFrom(argPath);
    process.stdout.write(`${JSON.stringify({ action: 'restore', ...restoreInfo }, null, 2)}\n`);
  } else {
    throw new Error(`Unknown database CLI action "${action}". Expected migrate|integrity|backup|restore.`);
  }

  db.close();
} catch (error) {
  process.stderr.write(`Database CLI error: ${error.message}\n`);
  process.exit(1);
}
