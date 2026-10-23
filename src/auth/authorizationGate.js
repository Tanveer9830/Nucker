import { MessageFlags } from 'discord.js';
import { isValidSnowflake } from '../utils/ids.js';
import { redactSecrets } from '../utils/redaction.js';

export const AUTHORIZED_MIDDLEWARE_BRAND = Symbol.for('tanveer.beta.newker.operatorAuthWrapped');

export class UnauthorizedOperatorError extends Error {
  constructor(message = 'Access denied: authorized operator only.', auditId = null) {
    super(message);
    this.name = 'UnauthorizedOperatorError';
    this.auditId = auditId;
  }
}

export class AuthorizationGate {
  constructor({ config, repositories = null, logger = null }) {
    if (!config) {
      throw new Error('AuthorizationGate requires a configuration object.');
    }
    this.config = config;
    this.repositories = repositories;
    this.logger = logger;
  }

  /**
   * Evaluates strict operator-only authorization using ONLY the numeric Discord User ID.
   * Deny-by-default on any missing, invalid, disabled, or non-matching state.
   */
  evaluate({
    invokingUserId,
    interactionType = 'command',
    actionName = 'unknown',
    guildId = null,
    channelId = null,
    metadata = {}
  }) {
    const configuredOperatorId = this.config?.authorizedOperatorId || '';
    const safeMetadata = redactSecrets(
      metadata,
      [this.config?.discordToken, this.config?.telemetryWebhook?.secret].filter(Boolean)
    );

    let authorized = false;
    let reason = 'DENY_BY_DEFAULT';

    if (!this.config?.privilegedEnabled || !isValidSnowflake(configuredOperatorId)) {
      authorized = false;
      reason = 'PRIVILEGED_MODE_DISABLED_INVALID_OPERATOR_CONFIG';
    } else if (typeof invokingUserId !== 'string' || !isValidSnowflake(invokingUserId)) {
      authorized = false;
      reason = 'MISSING_OR_MALFORMED_INVOKING_USER_ID';
    } else if (invokingUserId !== configuredOperatorId) {
      authorized = false;
      reason = 'USER_ID_MISMATCH';
    } else {
      authorized = true;
      reason = 'EXACT_OPERATOR_ID_MATCH';
    }

    const decision = authorized ? 'ALLOWED' : 'DENIED';
    let auditId = null;

    if (this.repositories) {
      try {
        const auditRecord = this.repositories.insertAuthAudit({
          invokingUserId: invokingUserId ? String(invokingUserId) : 'UNKNOWN',
          configuredOperatorId: configuredOperatorId || 'UNSET',
          interactionType,
          actionName,
          guildId,
          channelId,
          decision,
          reason,
          metadata: safeMetadata
        });
        auditId = auditRecord.auditId;
      } catch (dbErr) {
        this.logger?.error('Failed to persist authorization audit record to SQLite', {
          decision,
          actionName,
          error: dbErr.message
        });
        // Fail closed if audit persistence fails on an otherwise allowed check?
        // Keep denial unconditional; log audit error clearly.
      }
    }

    if (authorized) {
      this.logger?.debug('Authorized operator interaction verified', {
        auditId,
        interactionType,
        actionName,
        guildId
      });
    } else {
      this.logger?.warn('Rejected unauthorized interaction attempt', {
        auditId,
        invokingUserId: invokingUserId ? String(invokingUserId) : 'UNKNOWN',
        interactionType,
        actionName,
        guildId,
        reason
      });
    }

    return {
      authorized,
      decision,
      reason,
      auditId
    };
  }

  /**
   * Sends a safe, non-leaking ephemeral denial response to an unauthorized Discord interaction.
   */
  async sendInteractionDenial(interaction) {
    const content =
      'Access denied. Tanveer Ka Beta Newker is restricted exclusively to the authorized operator.';
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      } else if (typeof interaction.reply === 'function') {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      this.logger?.warn('Unable to send ephemeral denial reply to unauthorized interaction', {
        error: err.message
      });
    }
  }

  /**
   * Wraps a slash command definition so server-side authorization is guaranteed before execution.
   */
  wrapCommand(commandModule) {
    if (!commandModule || !commandModule.data || typeof commandModule.execute !== 'function') {
      throw new Error('Invalid command module passed to AuthorizationGate.wrapCommand().');
    }

    const commandName = commandModule.data.name;

    const wrappedExecute = async (interaction, context) => {
      const invokingUserId = interaction?.user?.id ?? null;
      const check = this.evaluate({
        invokingUserId,
        interactionType: 'chat_input_command',
        actionName: `/${commandName}`,
        guildId: interaction?.guildId ?? interaction?.guild?.id ?? null,
        channelId: interaction?.channelId ?? interaction?.channel?.id ?? null,
        metadata: {
          commandName
        }
      });

      if (!check.authorized) {
        await this.sendInteractionDenial(interaction);
        return {
          authorized: false,
          denied: true,
          auditId: check.auditId,
          reason: check.reason
        };
      }

      return commandModule.execute(interaction, {
        ...context,
        authAuditId: check.auditId
      });
    };

    const wrapped = {
      ...commandModule,
      execute: wrappedExecute,
      [AUTHORIZED_MIDDLEWARE_BRAND]: true
    };

    return Object.freeze(wrapped);
  }

  /**
   * Wraps any Discord message component / modal handler (button, select menu, modal submit).
   */
  wrapComponent(componentKey, interactionType, handlerFn) {
    if (typeof handlerFn !== 'function') {
      throw new Error(`Component "${componentKey}" requires a handler function.`);
    }

    const wrappedFn = async (interaction, context) => {
      const invokingUserId = interaction?.user?.id ?? null;
      const check = this.evaluate({
        invokingUserId,
        interactionType,
        actionName: componentKey,
        guildId: interaction?.guildId ?? interaction?.guild?.id ?? null,
        channelId: interaction?.channelId ?? interaction?.channel?.id ?? null,
        metadata: {
          customId: interaction?.customId ?? componentKey
        }
      });

      if (!check.authorized) {
        await this.sendInteractionDenial(interaction);
        return {
          authorized: false,
          denied: true,
          auditId: check.auditId,
          reason: check.reason
        };
      }

      return handlerFn(interaction, {
        ...context,
        authAuditId: check.auditId
      });
    };

    wrappedFn[AUTHORIZED_MIDDLEWARE_BRAND] = true;
    return wrappedFn;
  }

  static isWrapped(target) {
    return Boolean(target && target[AUTHORIZED_MIDDLEWARE_BRAND] === true);
  }
}
