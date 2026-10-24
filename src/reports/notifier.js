import fs from 'node:fs';
import path from 'node:path';
import { MessageFlags } from 'discord.js';
import { redactSecrets } from '../utils/redaction.js';

const DISCORD_MAX_CHUNK_CHARS = 1900;

export function splitMarkdownForDiscord(markdown, maxLen = DISCORD_MAX_CHUNK_CHARS) {
  if (!markdown || markdown.length <= maxLen) {
    return [markdown || ''];
  }

  const lines = markdown.split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    if (line.length > maxLen) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += maxLen) {
        chunks.push(line.slice(i, i + maxLen));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLen) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export class OperatorNotifier {
  constructor({
    config,
    repositories,
    discordClient = null,
    rateLimiter = null,
    logger = null
  }) {
    this.config = config;
    this.repositories = repositories;
    this.discordClient = discordClient;
    this.rateLimiter = rateLimiter;
    this.logger = logger;
  }

  archiveReportLocally(observationId, structuredReport, renderedMarkdown) {
    const archiveDir = this.config.reportArchiveDir;
    fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });

    const mdPath = path.join(archiveDir, `${observationId}.md`);
    const jsonPath = path.join(archiveDir, `${observationId}.json`);

    fs.writeFileSync(mdPath, renderedMarkdown, { mode: 0o600 });
    fs.writeFileSync(jsonPath, JSON.stringify(structuredReport, null, 2), { mode: 0o600 });

    return { mdPath, jsonPath };
  }

  /**
   * Persists report to SQLite + restricted archive and delivers via private DM to AUTHORIZED_OPERATOR_ID.
   * Falls back safely to private ephemeral interaction notification without exposing findings publicly.
   */
  async deliverPrivateReport({
    observationId,
    reportType = 'OBSERVATION_REPORT',
    structuredReport,
    renderedMarkdown,
    interaction = null
  }) {
    const safeStructured = redactSecrets(
      structuredReport,
      [this.config.discordToken, this.config.telemetryWebhook?.secret].filter(Boolean)
    );

    let archiveInfo = { mdPath: null, jsonPath: null };
    try {
      archiveInfo = this.archiveReportLocally(observationId, safeStructured, renderedMarkdown);
    } catch (archiveErr) {
      this.logger?.warn('Could not write local archive file for report (SQLite copy preserved)', {
        observationId,
        error: archiveErr.message
      });
    }

    this.repositories.upsertReport({
      observationId,
      reportType,
      structuredReport: safeStructured,
      renderedMarkdown,
      dmDeliveryStatus: 'PENDING',
      archivePath: archiveInfo.mdPath
    });

    const operatorId = this.config.authorizedOperatorId;

    // Attempt private Discord DM to the exclusive operator ID
    if (this.discordClient && typeof this.discordClient.users?.fetch === 'function') {
      try {
        const sendDmFn = async () => {
          const operatorUser = await this.discordClient.users.fetch(operatorId);
          const chunks = splitMarkdownForDiscord(renderedMarkdown);
          for (const chunk of chunks) {
            await operatorUser.send({ content: chunk });
          }
        };

        if (this.rateLimiter) {
          await this.rateLimiter.execute(sendDmFn, { label: 'operator-dm-report' });
        } else {
          await sendDmFn();
        }

        const deliveredAt = new Date().toISOString();
        this.repositories.upsertReport({
          observationId,
          reportType,
          structuredReport: safeStructured,
          renderedMarkdown,
          dmDeliveryStatus: 'DELIVERED',
          dmDeliveredAt: deliveredAt,
          fallbackStatus: 'NOT_NEEDED',
          archivePath: archiveInfo.mdPath
        });

        return {
          dmDelivered: true,
          fallbackUsed: false,
          archivePath: archiveInfo.mdPath
        };
      } catch (dmError) {
        this.logger?.warn('Discord DM delivery to operator failed; activating private fallback', {
          observationId,
          error: dmError.message
        });
      }
    }

    // Fallback: Notify operator privately via ephemeral interaction followUp if available
    let fallbackStatus = 'SAVED_TO_DB_AND_RESTRICTED_ARCHIVE';
    let ephemeralNotified = false;

    if (interaction && typeof interaction.followUp === 'function') {
      try {
        const notice = [
          `**Private DM Delivery Fallback (\`${observationId}\`)**`,
          'Discord could not deliver the report via DM (offline mode or DMs closed).',
          'Your full report has been preserved securely in SQLite and restricted local storage.',
          'Retrieve it privately anytime via `/observe-report` or `/observe-export`.'
        ].join('\n');
        await interaction.followUp({
          content: notice,
          flags: MessageFlags.Ephemeral
        });
        fallbackStatus = 'EPHEMERAL_OPERATOR_FALLBACK_DELIVERED';
        ephemeralNotified = true;
      } catch (ephemeralErr) {
        this.logger?.warn('Ephemeral interaction fallback notification also unavailable', {
          observationId,
          error: ephemeralErr.message
        });
      }
    }

    this.repositories.upsertReport({
      observationId,
      reportType,
      structuredReport: safeStructured,
      renderedMarkdown,
      dmDeliveryStatus: 'FAILED',
      dmDeliveredAt: null,
      fallbackStatus,
      archivePath: archiveInfo.mdPath
    });

    return {
      dmDelivered: false,
      fallbackUsed: true,
      ephemeralNotified,
      fallbackStatus,
      archivePath: archiveInfo.mdPath
    };
  }
}
