import { PermissionsBitField } from 'discord.js';
import { sanitizeConfigForDisplay } from '../config/index.js';
import {
  EVIDENCE_SOURCES,
  RECOMMENDED_OBSERVATION_PERMISSIONS
} from '../utils/constants.js';

export class EnvironmentDiscovery {
  constructor({
    config,
    db,
    astraAdapter,
    evidenceStore,
    discordClient = null,
    logger = null
  }) {
    this.config = config;
    this.db = db;
    this.astraAdapter = astraAdapter;
    this.evidenceStore = evidenceStore;
    this.discordClient = discordClient;
    this.logger = logger;
  }

  /**
   * Stage 3: Inspects available Discord metadata using only authorized bot access.
   */
  async inspectDiscordMetadata({ observationId, interaction = null, guildOverride = null }) {
    const guild = guildOverride || interaction?.guild || null;
    const clientReady =
      typeof this.discordClient?.isReady === 'function'
        ? Boolean(this.discordClient.isReady())
        : false;

    if (!guild) {
      return {
        guildConnected: false,
        botConnected: clientReady,
        guildId: interaction?.guildId || this.config.devGuildId || null,
        guildName: null,
        availablePermissions: [],
        missingPermissions: [...RECOMMENDED_OBSERVATION_PERMISSIONS],
        channelCount: 0,
        roleCount: 0,
        installedBots: [],
        selfBotId: this.discordClient?.user?.id || this.config.discordClientId || null,
        intentsConfigured: this.extractConfiguredIntents()
      };
    }

    const selfId = this.discordClient?.user?.id || this.config.discordClientId || null;
    const me =
      guild.members?.me ||
      (selfId && guild.members?.cache?.get ? guild.members.cache.get(selfId) : null) ||
      null;

    let availablePermissions = [];
    if (me?.permissions) {
      if (typeof me.permissions.toArray === 'function') {
        availablePermissions = me.permissions.toArray();
      } else if (Array.isArray(me.permissions)) {
        availablePermissions = [...me.permissions];
      } else if (typeof me.permissions === 'bigint' || typeof me.permissions === 'number') {
        availablePermissions = new PermissionsBitField(BigInt(me.permissions)).toArray();
      }
    } else if (Array.isArray(guild.botPermissions)) {
      availablePermissions = [...guild.botPermissions];
    }

    const hasAdmin = availablePermissions.includes('Administrator');
    const missingPermissions = hasAdmin
      ? []
      : RECOMMENDED_OBSERVATION_PERMISSIONS.filter((p) => !availablePermissions.includes(p));

    // Extract cached bot members safely without probing private bot internals
    const installedBots = [];
    if (Array.isArray(guild.installedBots)) {
      installedBots.push(...guild.installedBots);
    } else if (guild.members?.cache && typeof guild.members.cache.values === 'function') {
      for (const member of guild.members.cache.values()) {
        if (member?.user?.bot) {
          installedBots.push({
            id: member.user.id,
            username: member.user.username
          });
        }
      }
    }

    const channelCount =
      typeof guild.channels?.cache?.size === 'number'
        ? guild.channels.cache.size
        : Number(guild.channelCount ?? 0);
    const roleCount =
      typeof guild.roles?.cache?.size === 'number'
        ? guild.roles.cache.size
        : Number(guild.roleCount ?? 0);

    const metadata = {
      guildConnected: true,
      botConnected: clientReady || true,
      guildId: String(guild.id),
      guildName: String(guild.name || 'Unnamed Guild'),
      availablePermissions,
      missingPermissions,
      channelCount,
      roleCount,
      installedBots,
      selfBotId: selfId,
      intentsConfigured: this.extractConfiguredIntents()
    };

    if (observationId && this.evidenceStore) {
      this.evidenceStore.recordEvidence({
        observationId,
        scenarioId: 'ENV-DISCORD',
        sourceType: EVIDENCE_SOURCES.LIVE_DISCORD_OBSERVATION,
        summary: `Inspected live Discord guild metadata for "${metadata.guildName}" (${metadata.guildId})`,
        relationshipExplanation:
          'Authorized Discord guild metadata collected directly during Stage 3 environment discovery.',
        metadata: {
          guildId: metadata.guildId,
          guildName: metadata.guildName,
          channelCount,
          roleCount,
          installedBotCount: installedBots.length,
          missingPermissions
        }
      });
    }

    return metadata;
  }

  extractConfiguredIntents() {
    const bitfield = this.discordClient?.options?.intents;
    if (!bitfield) return [];
    if (typeof bitfield.toArray === 'function') {
      return bitfield.toArray();
    }
    if (Array.isArray(bitfield)) {
      return bitfield.map(String);
    }
    return [];
  }

  /**
   * Stage 4 & Stage 5: Identifies Astra Astra integration & checks collector/database health.
   */
  async inspectIntegrationsAndHealth({ observationId, discordMetadata }) {
    const targetDiscovery = await this.astraAdapter.identifyTarget(discordMetadata);
    const telemetry = await this.astraAdapter.collectTelemetry();
    const adapterHealth = await this.astraAdapter.getHealth();
    const databaseHealth = this.db.checkIntegrity();

    if (observationId && telemetry.available && this.evidenceStore) {
      this.evidenceStore.recordEvidence({
        observationId,
        scenarioId: 'ENV-ASTRA-TELEMETRY',
        sourceType: EVIDENCE_SOURCES.IMPORTED_ASTRA_TELEMETRY,
        summary: `Loaded ${telemetry.events.length} validated Astra Astra telemetry event(s) from [${telemetry.activeSources.join(', ')}]`,
        relationshipExplanation:
          'Imported and validated external Astra Astra telemetry records prior to scenario correlation.',
        metadata: {
          activeSources: telemetry.activeSources,
          eventCount: telemetry.events.length,
          targetVersion: telemetry.version
        }
      });
    }

    const collectorHealth = {
      healthy: adapterHealth.healthy && databaseHealth.healthy,
      adapterHealthy: adapterHealth.healthy,
      databaseHealthy: databaseHealth.healthy,
      errors: [...(adapterHealth.errors || [])]
    };

    return {
      targetDiscovery,
      telemetry: {
        available: telemetry.available,
        activeSources: telemetry.activeSources,
        eventCount: telemetry.events.length,
        version: telemetry.version,
        errors: telemetry.errors
      },
      rawTelemetryEvents: telemetry.events,
      collectorHealth,
      databaseHealth,
      observationConfig: sanitizeConfigForDisplay(this.config)
    };
  }
}
