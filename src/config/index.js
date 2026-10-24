import path from 'node:path';
import dotenv from 'dotenv';
import {
  APP_NAME,
  APP_VERSION,
  CREATOR_ATTRIBUTION,
  TARGET_SYSTEM_NAME
} from '../utils/constants.js';
import { isValidSnowflake } from '../utils/ids.js';

export class ConfigValidationError extends Error {
  constructor(message, errors = [], warnings = []) {
    super(message);
    this.name = 'ConfigValidationError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'silent']);

function parseBoolean(rawValue, defaultValue, fieldName, errors) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return defaultValue;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  errors.push(`${fieldName} must be "true" or "false" (received "${rawValue}").`);
  return defaultValue;
}

function parseIntBounded(rawValue, defaultValue, min, max, fieldName, errors) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return defaultValue;
  }
  const str = String(rawValue).trim();
  if (!/^-?\d+$/.test(str)) {
    errors.push(`${fieldName} must be an integer between ${min} and ${max}.`);
    return defaultValue;
  }
  const parsed = Number.parseInt(str, 10);
  if (parsed < min || parsed > max) {
    errors.push(`${fieldName} must be between ${min} and ${max} (received ${parsed}).`);
    return defaultValue;
  }
  return parsed;
}

function parseOptionalSnowflake(rawValue, fieldName, errors) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return '';
  }
  const trimmed = String(rawValue).trim();
  if (!isValidSnowflake(trimmed)) {
    errors.push(`${fieldName} must be a valid numeric Discord Snowflake ID (17-20 digits).`);
    return '';
  }
  return trimmed;
}

export function loadConfig({
  env = null,
  dotenvPath = undefined,
  loadDotenv = env === null,
  requireDiscordCredentials = false,
  strict = true
} = {}) {
  if (loadDotenv) {
    dotenv.config(dotenvPath ? { path: dotenvPath } : undefined);
  }
  const sourceEnv = env ?? process.env;

  const errors = [];
  const warnings = [];

  // 1. Validate Operator Identity (STRICT numeric Discord User ID only)
  const rawOperatorId =
    sourceEnv.AUTHORIZED_OPERATOR_ID !== undefined
      ? String(sourceEnv.AUTHORIZED_OPERATOR_ID).trim()
      : '';

  let authorizedOperatorId = '';
  let privilegedEnabled = false;

  if (!rawOperatorId) {
    errors.push(
      'AUTHORIZED_OPERATOR_ID is missing. Privileged functionality is refused without a valid numeric Discord user ID.'
    );
  } else if (!isValidSnowflake(rawOperatorId)) {
    errors.push(
      'AUTHORIZED_OPERATOR_ID is invalid. Only a 17-20 digit numeric Discord user ID is accepted (usernames, roles, or tags are forbidden).'
    );
  } else {
    authorizedOperatorId = rawOperatorId;
    privilegedEnabled = true;
  }

  // 2. Discord application credentials
  const discordToken = sourceEnv.DISCORD_TOKEN ? String(sourceEnv.DISCORD_TOKEN).trim() : '';
  const discordClientId = parseOptionalSnowflake(
    sourceEnv.DISCORD_CLIENT_ID,
    'DISCORD_CLIENT_ID',
    errors
  );
  const devGuildId = parseOptionalSnowflake(sourceEnv.DEV_GUILD_ID, 'DEV_GUILD_ID', errors);

  if (requireDiscordCredentials) {
    if (!discordToken) {
      errors.push('DISCORD_TOKEN is required to connect to Discord Gateway or register commands.');
    }
    if (!discordClientId) {
      errors.push('DISCORD_CLIENT_ID is required to register or run Discord interactions.');
    }
  } else {
    if (!discordToken) {
      warnings.push('DISCORD_TOKEN is empty (offline/local test mode only).');
    }
    if (!discordClientId) {
      warnings.push('DISCORD_CLIENT_ID is empty (command registration unavailable until set).');
    }
  }

  // 3. Storage & Logging
  const rawDbPath = sourceEnv.DATABASE_PATH
    ? String(sourceEnv.DATABASE_PATH).trim()
    : './data/tanveer-beta-newker.sqlite';
  const databasePath = rawDbPath === ':memory:' ? ':memory:' : path.resolve(rawDbPath);

  const rawLogLevel = sourceEnv.LOG_LEVEL
    ? String(sourceEnv.LOG_LEVEL).trim().toLowerCase()
    : 'info';
  let logLevel = 'info';
  if (!VALID_LOG_LEVELS.has(rawLogLevel)) {
    errors.push(
      `LOG_LEVEL must be one of ${Array.from(VALID_LOG_LEVELS).join(', ')} (received "${rawLogLevel}").`
    );
  } else {
    logLevel = rawLogLevel;
  }

  // 4. Simulation & Safety Boundaries
  const simulationMode = parseBoolean(
    sourceEnv.SIMULATION_MODE,
    true,
    'SIMULATION_MODE',
    errors
  );
  const requireTestGuildAllowlist = parseBoolean(
    sourceEnv.REQUIRE_TEST_GUILD_ALLOWLIST,
    true,
    'REQUIRE_TEST_GUILD_ALLOWLIST',
    errors
  );
  const maxConcurrentScenarios = parseIntBounded(
    sourceEnv.MAX_CONCURRENT_SCENARIOS,
    3,
    1,
    10,
    'MAX_CONCURRENT_SCENARIOS',
    errors
  );
  const maxObservationDurationMinutes = parseIntBounded(
    sourceEnv.MAX_OBSERVATION_DURATION_MINUTES,
    15,
    1,
    60,
    'MAX_OBSERVATION_DURATION_MINUTES',
    errors
  );

  // 5. Guild Allowlist
  const allowlistSet = new Set();
  if (devGuildId) {
    allowlistSet.add(devGuildId);
  }
  if (sourceEnv.TEST_GUILD_ALLOWLIST && String(sourceEnv.TEST_GUILD_ALLOWLIST).trim()) {
    const entries = String(sourceEnv.TEST_GUILD_ALLOWLIST)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const guildId of entries) {
      if (!isValidSnowflake(guildId)) {
        errors.push(
          `TEST_GUILD_ALLOWLIST contains invalid Discord Guild ID "${guildId}".`
        );
      } else {
        allowlistSet.add(guildId);
      }
    }
  }
  const testGuildAllowlist = Object.freeze(Array.from(allowlistSet));

  if (requireTestGuildAllowlist && testGuildAllowlist.length === 0) {
    warnings.push(
      'REQUIRE_TEST_GUILD_ALLOWLIST is true, and no guild IDs are configured in DEV_GUILD_ID or TEST_GUILD_ALLOWLIST. Controlled test approval will remain blocked until an authorized test guild ID is added.'
    );
  }

  // 6. Astra Astra Integration Settings
  const astraAstraBotId = parseOptionalSnowflake(
    sourceEnv.ASTRA_ASTRA_BOT_ID,
    'ASTRA_ASTRA_BOT_ID',
    errors
  );
  const astraAstraName = sourceEnv.ASTRA_ASTRA_NAME
    ? String(sourceEnv.ASTRA_ASTRA_NAME).trim()
    : TARGET_SYSTEM_NAME;
  const astraAstraVersion = sourceEnv.ASTRA_ASTRA_VERSION
    ? String(sourceEnv.ASTRA_ASTRA_VERSION).trim()
    : '';
  const astraAstraLogPath = sourceEnv.ASTRA_ASTRA_LOG_PATH
    ? path.resolve(String(sourceEnv.ASTRA_ASTRA_LOG_PATH).trim())
    : '';
  const astraAstraIncidentPath = sourceEnv.ASTRA_ASTRA_INCIDENT_PATH
    ? path.resolve(String(sourceEnv.ASTRA_ASTRA_INCIDENT_PATH).trim())
    : '';
  const astraAstraDetectionHistoryPath = sourceEnv.ASTRA_ASTRA_DETECTION_HISTORY_PATH
    ? path.resolve(String(sourceEnv.ASTRA_ASTRA_DETECTION_HISTORY_PATH).trim())
    : '';

  if (!astraAstraBotId) {
    warnings.push(
      'ASTRA_ASTRA_BOT_ID is not set. Target identification will rely only on verified imported telemetry and will refuse to guess among multiple guild bots.'
    );
  }

  // 7. Authenticated Telemetry Webhook
  const enableTelemetryWebhook = parseBoolean(
    sourceEnv.ENABLE_TELEMETRY_WEBHOOK,
    false,
    'ENABLE_TELEMETRY_WEBHOOK',
    errors
  );
  const telemetryWebhookHost = sourceEnv.TELEMETRY_WEBHOOK_HOST
    ? String(sourceEnv.TELEMETRY_WEBHOOK_HOST).trim()
    : '127.0.0.1';
  const telemetryWebhookPort = parseIntBounded(
    sourceEnv.TELEMETRY_WEBHOOK_PORT,
    8787,
    1024,
    65535,
    'TELEMETRY_WEBHOOK_PORT',
    errors
  );
  const telemetryWebhookSecret = sourceEnv.TELEMETRY_WEBHOOK_SECRET
    ? String(sourceEnv.TELEMETRY_WEBHOOK_SECRET).trim()
    : '';

  if (enableTelemetryWebhook && telemetryWebhookSecret.length < 16) {
    errors.push(
      'TELEMETRY_WEBHOOK_SECRET must be at least 16 characters when ENABLE_TELEMETRY_WEBHOOK=true.'
    );
  }

  // 8. Data Retention & Reporting
  const dataRetentionDays = parseIntBounded(
    sourceEnv.DATA_RETENTION_DAYS,
    90,
    1,
    3650,
    'DATA_RETENTION_DAYS',
    errors
  );
  const reportArchiveDir = path.resolve(
    sourceEnv.REPORT_ARCHIVE_DIR
      ? String(sourceEnv.REPORT_ARCHIVE_DIR).trim()
      : './data/exports'
  );
  const fallbackOperatorChannelId = parseOptionalSnowflake(
    sourceEnv.FALLBACK_OPERATOR_CHANNEL_ID,
    'FALLBACK_OPERATOR_CHANNEL_ID',
    errors
  );

  // If any validation errors exist, disable privileged mode unconditionally
  if (errors.length > 0) {
    privilegedEnabled = false;
  }

  const config = Object.freeze({
    appName: APP_NAME,
    appVersion: APP_VERSION,
    creatorAttribution: CREATOR_ATTRIBUTION,
    authorizedOperatorId,
    privilegedEnabled,
    discordToken,
    discordClientId,
    devGuildId,
    databasePath,
    logLevel,
    simulationMode,
    requireTestGuildAllowlist,
    maxConcurrentScenarios,
    maxObservationDurationMinutes,
    maxObservationDurationMs: maxObservationDurationMinutes * 60 * 1000,
    testGuildAllowlist,
    astraAstra: Object.freeze({
      botId: astraAstraBotId,
      name: astraAstraName,
      version: astraAstraVersion,
      logPath: astraAstraLogPath,
      incidentPath: astraAstraIncidentPath,
      detectionHistoryPath: astraAstraDetectionHistoryPath
    }),
    telemetryWebhook: Object.freeze({
      enabled: enableTelemetryWebhook,
      host: telemetryWebhookHost,
      port: telemetryWebhookPort,
      secret: telemetryWebhookSecret
    }),
    dataRetentionDays,
    reportArchiveDir,
    fallbackOperatorChannelId,
    validation: Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze([...errors]),
      warnings: Object.freeze([...warnings])
    })
  });

  if (strict && errors.length > 0) {
    throw new ConfigValidationError(
      `Configuration validation failed with ${errors.length} error(s): ${errors.join(' ')}`,
      errors,
      warnings
    );
  }

  return config;
}

/**
 * Produces a guaranteed secret-free view of the configuration for display, reports, and persistence.
 */
export function sanitizeConfigForDisplay(config) {
  return {
    appName: config.appName,
    appVersion: config.appVersion,
    creatorAttribution: config.creatorAttribution,
    authorizedOperatorId: config.authorizedOperatorId || null,
    privilegedEnabled: Boolean(config.privilegedEnabled),
    discordTokenConfigured: Boolean(config.discordToken),
    discordClientId: config.discordClientId || null,
    devGuildId: config.devGuildId || null,
    databasePath: config.databasePath,
    logLevel: config.logLevel,
    simulationMode: config.simulationMode,
    requireTestGuildAllowlist: config.requireTestGuildAllowlist,
    maxConcurrentScenarios: config.maxConcurrentScenarios,
    maxObservationDurationMinutes: config.maxObservationDurationMinutes,
    testGuildAllowlist: [...(config.testGuildAllowlist || [])],
    astraAstra: {
      botId: config.astraAstra?.botId || null,
      name: config.astraAstra?.name || TARGET_SYSTEM_NAME,
      version: config.astraAstra?.version || null,
      logPathConfigured: Boolean(config.astraAstra?.logPath),
      incidentPathConfigured: Boolean(config.astraAstra?.incidentPath),
      detectionHistoryPathConfigured: Boolean(config.astraAstra?.detectionHistoryPath)
    },
    telemetryWebhook: {
      enabled: Boolean(config.telemetryWebhook?.enabled),
      host: config.telemetryWebhook?.host || '127.0.0.1',
      port: config.telemetryWebhook?.port || 8787,
      secretConfigured: Boolean(config.telemetryWebhook?.secret)
    },
    dataRetentionDays: config.dataRetentionDays,
    reportArchiveDir: config.reportArchiveDir,
    fallbackOperatorChannelId: config.fallbackOperatorChannelId || null,
    validation: {
      valid: Boolean(config.validation?.valid),
      errors: [...(config.validation?.errors || [])],
      warnings: [...(config.validation?.warnings || [])]
    }
  };
}
