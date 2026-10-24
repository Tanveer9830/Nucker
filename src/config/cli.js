import { loadConfig, sanitizeConfigForDisplay } from './index.js';

const requireDiscord = process.argv.includes('--require-discord');

try {
  const config = loadConfig({
    strict: false,
    requireDiscordCredentials: requireDiscord
  });
  const sanitized = sanitizeConfigForDisplay(config);
  process.stdout.write(`${JSON.stringify(sanitized, null, 2)}\n`);
  process.exit(config.validation.valid ? 0 : 1);
} catch (error) {
  process.stderr.write(`Configuration check failed: ${error.message}\n`);
  process.exit(1);
}
