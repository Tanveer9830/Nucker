import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import {
  EVIDENCE_SOURCES,
  TARGET_IDENTIFICATION_STATES,
  TARGET_SYSTEM_NAME
} from '../utils/constants.js';
import { generateId, isValidSnowflake } from '../utils/ids.js';
import { redactSecrets } from '../utils/redaction.js';
import {
  InputValidationError,
  parseValidTimestampMs,
  safeJsonParse,
  sanitizeText
} from '../utils/validation.js';
import { TargetIntegrationAdapter } from './adapterInterface.js';

const WEBHOOK_MAX_BODY_BYTES = 256 * 1024; // 256 KiB cap
const WEBHOOK_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5-minute replay window

export class AstraAstraAdapter extends TargetIntegrationAdapter {
  constructor({ config, logger = null } = {}) {
    super({ name: 'AstraAstraAdapter' });
    this.config = config;
    this.logger = logger;
    this.webhookBuffer = [];
    this.seenWebhookIds = new Set();
    this.testInterfaceResponses = [];
    this.webhookServer = null;
    this.stats = {
      importedLogEvents: 0,
      importedIncidents: 0,
      importedDetections: 0,
      webhookEventsAccepted: 0,
      webhookEventsRejected: 0,
      validationErrors: 0
    };
  }

  /**
   * Computes HMAC-SHA256 signature over `${timestamp}.${rawBody}` for authenticated webhooks.
   */
  static signWebhookPayload(secret, timestampMs, rawBody) {
    return crypto
      .createHmac('sha256', secret)
      .update(`${timestampMs}.${rawBody}`, 'utf8')
      .digest('hex');
  }

  /**
   * Verifies and ingests an authenticated webhook event (used both by HTTP server and direct tests).
   */
  ingestAuthenticatedWebhook({ headers = {}, rawBody = '' }) {
    const secret = this.config?.telemetryWebhook?.secret || '';
    if (!secret || secret.length < 16) {
      this.stats.webhookEventsRejected += 1;
      throw new InputValidationError('Telemetry webhook secret is not configured.');
    }

    const sigHeader = String(
      headers['x-astra-signature'] || headers['X-Astra-Signature'] || ''
    ).trim();
    const tsHeader = String(
      headers['x-astra-timestamp'] || headers['X-Astra-Timestamp'] || ''
    ).trim();

    if (!sigHeader || !tsHeader) {
      this.stats.webhookEventsRejected += 1;
      throw new InputValidationError(
        'Missing required X-Astra-Signature or X-Astra-Timestamp header.'
      );
    }

    const timestampMs = parseValidTimestampMs(tsHeader, 'X-Astra-Timestamp');
    const skew = Math.abs(Date.now() - timestampMs);
    if (skew > WEBHOOK_MAX_CLOCK_SKEW_MS) {
      this.stats.webhookEventsRejected += 1;
      throw new InputValidationError(
        `Webhook timestamp outside allowed ${WEBHOOK_MAX_CLOCK_SKEW_MS}ms replay window.`
      );
    }

    const expectedHex = AstraAstraAdapter.signWebhookPayload(secret, tsHeader, rawBody);
    const providedHex = sigHeader.replace(/^sha256=/i, '');

    if (
      providedHex.length !== expectedHex.length ||
      !/^[0-9a-f]+$/i.test(providedHex) ||
      !crypto.timingSafeEqual(
        Buffer.from(providedHex.toLowerCase(), 'utf8'),
        Buffer.from(expectedHex.toLowerCase(), 'utf8')
      )
    ) {
      this.stats.webhookEventsRejected += 1;
      throw new InputValidationError('Invalid HMAC-SHA256 webhook signature.');
    }

    const parsed = safeJsonParse(rawBody, { maxBytes: WEBHOOK_MAX_BODY_BYTES });
    const normalized = this.validateAndNormalizeTelemetryRecord(parsed, 'AUTHENTICATED_WEBHOOK');

    if (normalized.id && this.seenWebhookIds.has(normalized.id)) {
      normalized.isDuplicate = true;
    } else if (normalized.id) {
      this.seenWebhookIds.add(normalized.id);
    }

    this.webhookBuffer.push(normalized);
    if (this.webhookBuffer.length > 5000) {
      this.webhookBuffer.shift();
    }
    this.stats.webhookEventsAccepted += 1;
    return normalized;
  }

  /**
   * Starts optional authenticated HTTP webhook listener when ENABLE_TELEMETRY_WEBHOOK=true.
   */
  async startWebhookServer() {
    if (!this.config?.telemetryWebhook?.enabled || this.webhookServer) {
      return null;
    }

    const { host, port } = this.config.telemetryWebhook;

    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/telemetry/astra-astra') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not found' }));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      let aborted = false;

      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > WEBHOOK_MAX_BODY_BYTES) {
          aborted = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (aborted) return;
        try {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const event = this.ingestAuthenticatedWebhook({
            headers: req.headers,
            rawBody
          });
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, id: event.id, duplicate: Boolean(event.isDuplicate) }));
        } catch (err) {
          this.logger?.warn('Rejected incoming Astra Astra telemetry webhook', {
            error: err.message
          });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Unauthorized or invalid telemetry payload' }));
        }
      });
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    this.webhookServer = server;
    const address = server.address();
    this.logger?.info('Started authenticated Astra Astra telemetry webhook receiver', {
      host,
      port: typeof address === 'object' && address ? address.port : port
    });
    return address;
  }

  async stopWebhookServer() {
    if (!this.webhookServer) return;
    const srv = this.webhookServer;
    this.webhookServer = null;
    await new Promise((resolve) => srv.close(() => resolve()));
  }

  /**
   * Registers a documented test-interface response (e.g., structured self-test or health response from Astra Astra).
   */
  ingestTestInterfaceResponse(rawPayload) {
    const parsed = typeof rawPayload === 'string' ? safeJsonParse(rawPayload) : rawPayload;
    const normalized = this.validateAndNormalizeTelemetryRecord(parsed, 'DOCUMENTED_TEST_INTERFACE');
    this.testInterfaceResponses.push(normalized);
    return normalized;
  }

  /**
   * Validates untrusted telemetry records from JSON logs, incident reports, detection histories,
   * webhooks, or documented test interfaces.
   */
  validateAndNormalizeTelemetryRecord(record, channelType = 'JSON_LOG') {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      this.stats.validationErrors += 1;
      throw new InputValidationError(
        `Expected telemetry object from ${channelType}, received ${typeof record}.`
      );
    }

    const timestampMs = parseValidTimestampMs(
      record.timestamp ?? record.detectedAt ?? record.createdAt ?? record.eventTimestampMs,
      'timestamp'
    );

    const kind = sanitizeText(
      String(record.kind || record.type || record.eventType || 'DETECTION'),
      128
    );
    const id = record.id ? sanitizeText(String(record.id), 128) : generateId('ast');
    const correlationKey = record.correlationKey
      ? sanitizeText(String(record.correlationKey), 128)
      : null;
    const scenarioId = record.scenarioId ? sanitizeText(String(record.scenarioId), 64) : null;
    const triggerEventType = record.triggerEventType
      ? sanitizeText(String(record.triggerEventType), 128)
      : null;
    const alertType = record.alertType ? sanitizeText(String(record.alertType), 128) : kind;
    const action = record.action ? sanitizeText(String(record.action), 128) : null;
    const botId =
      record.botId && isValidSnowflake(String(record.botId)) ? String(record.botId) : null;
    const version = record.version ? sanitizeText(String(record.version), 64) : null;

    let responseTimestampMs = null;
    if (record.responseTimestamp !== undefined && record.responseTimestamp !== null) {
      responseTimestampMs = parseValidTimestampMs(record.responseTimestamp, 'responseTimestamp');
    } else if (typeof record.responseTimestampMs === 'number') {
      responseTimestampMs = parseValidTimestampMs(record.responseTimestampMs, 'responseTimestampMs');
    }

    const responseLatencyMs =
      typeof record.responseLatencyMs === 'number' &&
      Number.isFinite(record.responseLatencyMs) &&
      record.responseLatencyMs >= 0
        ? record.responseLatencyMs
        : null;

    const safeRecord = redactSecrets(
      {
        id,
        channelType,
        sourceType: EVIDENCE_SOURCES.IMPORTED_ASTRA_TELEMETRY,
        kind,
        alertType,
        triggerEventType,
        action,
        correlationKey,
        scenarioId,
        botId,
        version: version || this.config?.astraAstra?.version || null,
        timestampMs,
        responseTimestampMs,
        responseLatencyMs,
        actionSucceeded:
          typeof record.actionSucceeded === 'boolean' ? record.actionSucceeded : null,
        evidenceRetained:
          typeof record.evidenceRetained === 'boolean' ? record.evidenceRetained : null,
        recovered: typeof record.recovered === 'boolean' ? record.recovered : null,
        isDuplicate: Boolean(record.isDuplicate),
        summary: record.summary
          ? sanitizeText(String(record.summary), 512)
          : `${channelType}:${kind}`
      },
      [this.config?.discordToken, this.config?.telemetryWebhook?.secret].filter(Boolean)
    );

    return safeRecord;
  }

  /**
   * Parses either a JSON array/object file or newline-delimited JSON (NDJSON) file safely.
   */
  parseStructuredFileContent(rawContent, channelType) {
    const trimmed = String(rawContent || '').trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = safeJsonParse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => this.validateAndNormalizeTelemetryRecord(item, channelType));
        }
        if (Array.isArray(parsed.events)) {
          return parsed.events.map((item) =>
            this.validateAndNormalizeTelemetryRecord(item, channelType)
          );
        }
        if (Array.isArray(parsed.incidents)) {
          return parsed.incidents.map((item) =>
            this.validateAndNormalizeTelemetryRecord(item, channelType)
          );
        }
        if (Array.isArray(parsed.detections)) {
          return parsed.detections.map((item) =>
            this.validateAndNormalizeTelemetryRecord(item, channelType)
          );
        }
        return [this.validateAndNormalizeTelemetryRecord(parsed, channelType)];
      } catch (firstErr) {
        // Check if NDJSON (multiple JSON objects separated by newlines)
        if (!trimmed.includes('\n')) {
          throw firstErr;
        }
      }
    }

    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.map((line) => {
      const obj = safeJsonParse(line);
      return this.validateAndNormalizeTelemetryRecord(obj, channelType);
    });
  }

  loadTelemetryFileIfConfigured(filePath, channelType) {
    if (!filePath) {
      return { configured: false, loaded: false, events: [], error: null };
    }
    if (!fs.existsSync(filePath)) {
      return {
        configured: true,
        loaded: false,
        events: [],
        error: `Configured ${channelType} path does not exist: ${filePath}`
      };
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const events = this.parseStructuredFileContent(raw, channelType);
      return {
        configured: true,
        loaded: true,
        events,
        error: null
      };
    } catch (error) {
      return {
        configured: true,
        loaded: false,
        events: [],
        error: `Failed to validate ${channelType}: ${error.message}`
      };
    }
  }

  /**
   * Collects all configured & buffered Astra Astra telemetry sources.
   */
  async collectTelemetry() {
    const astraCfg = this.config?.astraAstra || {};
    const errors = [];
    const activeSources = [];

    const jsonLogs = this.loadTelemetryFileIfConfigured(astraCfg.logPath, 'STRUCTURED_JSON_LOG');
    if (jsonLogs.loaded) {
      activeSources.push('STRUCTURED_JSON_LOG');
      this.stats.importedLogEvents += jsonLogs.events.length;
    } else if (jsonLogs.error) {
      errors.push(jsonLogs.error);
    }

    const incidents = this.loadTelemetryFileIfConfigured(
      astraCfg.incidentPath,
      'IMPORTED_INCIDENT_REPORT'
    );
    if (incidents.loaded) {
      activeSources.push('IMPORTED_INCIDENT_REPORT');
      this.stats.importedIncidents += incidents.events.length;
    } else if (incidents.error) {
      errors.push(incidents.error);
    }

    const history = this.loadTelemetryFileIfConfigured(
      astraCfg.detectionHistoryPath,
      'EXPORTED_DETECTION_HISTORY'
    );
    if (history.loaded) {
      activeSources.push('EXPORTED_DETECTION_HISTORY');
      this.stats.importedDetections += history.events.length;
    } else if (history.error) {
      errors.push(history.error);
    }

    if (this.webhookBuffer.length > 0) {
      activeSources.push('AUTHENTICATED_TELEMETRY_WEBHOOK');
    }

    if (this.testInterfaceResponses.length > 0) {
      activeSources.push('DOCUMENTED_TEST_INTERFACE');
    }

    const allEvents = [
      ...jsonLogs.events,
      ...incidents.events,
      ...history.events,
      ...this.webhookBuffer,
      ...this.testInterfaceResponses
    ].sort((a, b) => a.timestampMs - b.timestampMs);

    const reportedVersion =
      astraCfg.version ||
      allEvents.find((e) => e.version)?.version ||
      null;

    return {
      available: activeSources.length > 0,
      activeSources,
      events: allEvents,
      version: reportedVersion,
      errors
    };
  }

  /**
   * Establishes Astra Astra target identity ONLY when reliably verified (Part 4.2 & Part 6).
   * Never guesses among multiple installed bots in a guild.
   */
  async identifyTarget(guildMetadata = {}) {
    const configuredBotId = this.config?.astraAstra?.botId || '';
    const configuredName = this.config?.astraAstra?.name || TARGET_SYSTEM_NAME;
    const installedBots = Array.isArray(guildMetadata.installedBots)
      ? guildMetadata.installedBots
      : [];
    const selfBotId = this.config?.discordClientId || guildMetadata.selfBotId || null;

    const otherBots = installedBots.filter((b) => !selfBotId || b.id !== selfBotId);
    const telemetry = await this.collectTelemetry();

    // Case 1: Operator explicitly configured ASTRA_ASTRA_BOT_ID
    if (configuredBotId && isValidSnowflake(configuredBotId)) {
      const matchedInGuild = otherBots.find((b) => b.id === configuredBotId);
      if (matchedInGuild) {
        return {
          state: TARGET_IDENTIFICATION_STATES.VERIFIED,
          verified: true,
          botId: configuredBotId,
          botName: matchedInGuild.username || configuredName,
          version: telemetry.version,
          telemetryAvailable: telemetry.available,
          activeSources: telemetry.activeSources,
          candidateBots: [],
          clarificationNeeded: false,
          explanation: `Verified Astra Astra in guild via configured ASTRA_ASTRA_BOT_ID (${configuredBotId}).`
        };
      }

      if (telemetry.available) {
        return {
          state: TARGET_IDENTIFICATION_STATES.TELEMETRY_ONLY,
          verified: true,
          botId: configuredBotId,
          botName: configuredName,
          version: telemetry.version,
          telemetryAvailable: true,
          activeSources: telemetry.activeSources,
          candidateBots: [],
          clarificationNeeded: false,
          explanation: `Configured ASTRA_ASTRA_BOT_ID (${configuredBotId}) not observed in live guild member cache, but verified imported telemetry is active.`
        };
      }

      return {
        state: TARGET_IDENTIFICATION_STATES.CONFIGURED_NOT_PRESENT,
        verified: false,
        botId: configuredBotId,
        botName: configuredName,
        version: telemetry.version,
        telemetryAvailable: false,
        activeSources: [],
        candidateBots: otherBots,
        clarificationNeeded: true,
        explanation: `Configured ASTRA_ASTRA_BOT_ID (${configuredBotId}) is not present in the inspected guild and no telemetry sources are loaded.`
      };
    }

    // Case 2: No ASTRA_ASTRA_BOT_ID configured — check if imported telemetry carries a single verified botId
    const telemetryBotIds = Array.from(
      new Set(telemetry.events.map((e) => e.botId).filter(Boolean))
    );
    if (telemetryBotIds.length === 1) {
      const tBotId = telemetryBotIds[0];
      const matchedGuildBot = otherBots.find((b) => b.id === tBotId);
      return {
        state: matchedGuildBot
          ? TARGET_IDENTIFICATION_STATES.VERIFIED
          : TARGET_IDENTIFICATION_STATES.TELEMETRY_ONLY,
        verified: true,
        botId: tBotId,
        botName: matchedGuildBot?.username || configuredName,
        version: telemetry.version,
        telemetryAvailable: true,
        activeSources: telemetry.activeSources,
        candidateBots: [],
        clarificationNeeded: false,
        explanation: `Identified target bot ID (${tBotId}) from validated Astra Astra telemetry.`
      };
    }

    // Case 3: Multiple candidate bots exist in guild (or telemetry) without configured ASTRA_ASTRA_BOT_ID — NEVER GUESS!
    if (otherBots.length > 1 || telemetryBotIds.length > 1) {
      return {
        state: TARGET_IDENTIFICATION_STATES.AMBIGUOUS,
        verified: false,
        botId: null,
        botName: configuredName,
        version: telemetry.version,
        telemetryAvailable: telemetry.available,
        activeSources: telemetry.activeSources,
        candidateBots: otherBots.map((b) => ({ id: b.id, username: b.username })),
        clarificationNeeded: true,
        explanation: `Multiple candidate bots (${otherBots.length}) detected in guild while ASTRA_ASTRA_BOT_ID is unconfigured. Refusing to guess target identity; set ASTRA_ASTRA_BOT_ID in configuration.`
      };
    }

    // Case 4: Even if 0 or 1 unverified bot exists in guild without ASTRA_ASTRA_BOT_ID, do not invent verification
    return {
      state: TARGET_IDENTIFICATION_STATES.UNCONFIGURED,
      verified: false,
      botId: null,
      botName: configuredName,
      version: telemetry.version,
      telemetryAvailable: telemetry.available,
      activeSources: telemetry.activeSources,
      candidateBots: otherBots.map((b) => ({ id: b.id, username: b.username })),
      clarificationNeeded: true,
      explanation:
        otherBots.length === 1
          ? `One unverified bot (${otherBots[0].username} / ${otherBots[0].id}) found in guild, but ASTRA_ASTRA_BOT_ID is not configured to confirm it is Astra Astra.`
          : 'ASTRA_ASTRA_BOT_ID is not configured and no target bots or Astra Astra telemetry sources were detected.'
    };
  }

  getCapabilityVisibility(capabilityKey) {
    const astraCfg = this.config?.astraAstra || {};
    const anyTelemetryConfigured = Boolean(
      astraCfg.logPath ||
        astraCfg.incidentPath ||
        astraCfg.detectionHistoryPath ||
        this.config?.telemetryWebhook?.enabled ||
        this.webhookBuffer.length > 0 ||
        this.testInterfaceResponses.length > 0
    );

    if (!anyTelemetryConfigured) {
      return {
        available: false,
        reason: `Astra Astra internal telemetry for "${capabilityKey}" is unavailable because no log, incident, detection-history, or webhook adapter is active.`
      };
    }

    return {
      available: true,
      reason: 'Active Astra Astra telemetry adapter configured.'
    };
  }

  async getHealth() {
    const telemetry = await this.collectTelemetry();
    return {
      adapterName: this.adapterName,
      healthy: telemetry.errors.length === 0,
      configuredBotId: this.config?.astraAstra?.botId || null,
      configuredVersion: this.config?.astraAstra?.version || telemetry.version || null,
      telemetryAvailable: telemetry.available,
      activeSources: telemetry.activeSources,
      totalTelemetryEvents: telemetry.events.length,
      webhookListenerActive: Boolean(this.webhookServer),
      errors: telemetry.errors,
      stats: { ...this.stats }
    };
  }
}
