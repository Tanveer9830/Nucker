import { REST, Routes } from 'discord.js';
import { loadConfig } from '../config/index.js';
import { Logger } from '../logging/logger.js';
import { RateLimitAwareExecutor } from '../utils/rateLimiter.js';
import { getApplicationCommandsJsonPayload } from './index.js';

export async function registerDiscordCommands({
  config = null,
  restClient = null,
  globalScope = process.argv.includes('--global')
} = {}) {
  const cfg =
    config ||
    loadConfig({
      strict: true,
      requireDiscordCredentials: true
    });

  const logger = new Logger({
    level: cfg.logLevel,
    explicitSecrets: [cfg.discordToken, cfg.telemetryWebhook?.secret].filter(Boolean)
  });

  const payload = getApplicationCommandsJsonPayload();
  const rest = restClient || new REST({ version: '10' }).setToken(cfg.discordToken);
  const executor = new RateLimitAwareExecutor({ logger });

  const useGuildRoute = Boolean(cfg.devGuildId) && !globalScope;
  const route = useGuildRoute
    ? Routes.applicationGuildCommands(cfg.discordClientId, cfg.devGuildId)
    : Routes.applicationCommands(cfg.discordClientId);

  const registered = await executor.execute(
    () => rest.put(route, { body: payload }),
    { label: 'register-application-commands', timeoutMs: 30000 }
  );

  logger.info('Successfully registered Discord application slash commands', {
    scope: useGuildRoute ? `guild:${cfg.devGuildId}` : 'global',
    commandCount: Array.isArray(registered) ? registered.length : payload.length
  });

  return {
    scope: useGuildRoute ? 'guild' : 'global',
    guildId: useGuildRoute ? cfg.devGuildId : null,
    commandCount: Array.isArray(registered) ? registered.length : payload.length
  };
}

// Execute when invoked directly via `npm run commands:register`
if (import.meta.url === `file://${process.argv[1]}`) {
  registerDiscordCommands().catch((err) => {
    process.stderr.write(`Command registration failed: ${err.message}\n`);
    process.exit(1);
  });
}
