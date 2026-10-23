import { AuthorizationGate } from '../auth/authorizationGate.js';
import { stopCommand } from '../commands/controlCommands.js';
import { observeStatusCommand } from '../commands/observationCommands.js';
import { replyEphemeral } from './respond.js';

export class InteractionRouter {
  constructor({ authGate, commandRegistry, context, logger = null }) {
    if (!(authGate instanceof AuthorizationGate)) {
      throw new Error('InteractionRouter requires an AuthorizationGate instance.');
    }
    this.authGate = authGate;
    this.commandRegistry = commandRegistry;
    this.context = context;
    this.logger = logger;

    this.componentHandlers = new Map();
    this.registerComponent('btn_observe_status_refresh', 'button', async (interaction, ctx) =>
      observeStatusCommand.execute(interaction, ctx)
    );
    this.registerComponent('btn_emergency_stop', 'button', async (interaction, ctx) =>
      stopCommand.execute(interaction, ctx)
    );
  }

  registerComponent(customId, interactionType, handlerFn) {
    const wrapped = this.authGate.wrapComponent(customId, interactionType, handlerFn);
    this.componentHandlers.set(customId, wrapped);
  }

  async handleInteraction(interaction) {
    if (!interaction) return null;

    const explicitSecrets = [
      this.context.config?.discordToken,
      this.context.config?.telemetryWebhook?.secret
    ].filter(Boolean);

    try {
      // 1. Slash Commands
      if (typeof interaction.isChatInputCommand === 'function' && interaction.isChatInputCommand()) {
        const command = this.commandRegistry.get(interaction.commandName);
        if (!command) {
          // Still enforce server-side operator check first (deny-by-default before revealing unknown command)
          const check = this.authGate.evaluate({
            invokingUserId: interaction.user?.id,
            interactionType: 'chat_input_command',
            actionName: `/${interaction.commandName || 'unknown'}`,
            guildId: interaction.guildId ?? null,
            channelId: interaction.channelId ?? null
          });
          if (!check.authorized) {
            await this.authGate.sendInteractionDenial(interaction);
            return { authorized: false, denied: true };
          }
          await replyEphemeral(interaction, `Unknown command \`/${interaction.commandName}\`.`, {
            explicitSecrets
          });
          return { authorized: true, unknownCommand: true };
        }

        if (!AuthorizationGate.isWrapped(command)) {
          throw new Error(`Security invariant violation: /${interaction.commandName} is unwrapped.`);
        }

        return await command.execute(interaction, this.context);
      }

      // 2. Buttons, Select Menus, Modals, and Message Components
      const isComponentOrModal =
        (typeof interaction.isButton === 'function' && interaction.isButton()) ||
        (typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu()) ||
        (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit()) ||
        Boolean(interaction.customId);

      if (isComponentOrModal) {
        const customId = String(interaction.customId || 'unknown_component');
        const handler = this.componentHandlers.get(customId);
        if (handler) {
          return await handler(interaction, this.context);
        }

        // Deny-by-default check even on unregistered component/modal IDs
        const check = this.authGate.evaluate({
          invokingUserId: interaction.user?.id,
          interactionType: 'component_or_modal',
          actionName: customId,
          guildId: interaction.guildId ?? null,
          channelId: interaction.channelId ?? null
        });
        if (!check.authorized) {
          await this.authGate.sendInteractionDenial(interaction);
          return { authorized: false, denied: true, auditId: check.auditId };
        }

        await replyEphemeral(interaction, `Component action \`${customId}\` is no longer active.`, {
          explicitSecrets
        });
        return { authorized: true, unhandledComponent: true };
      }

      // 3. Any other future interaction type — enforce operator-only deny-by-default
      const fallbackCheck = this.authGate.evaluate({
        invokingUserId: interaction.user?.id,
        interactionType: 'other_interaction',
        actionName: 'untyped_interaction',
        guildId: interaction.guildId ?? null,
        channelId: interaction.channelId ?? null
      });
      if (!fallbackCheck.authorized) {
        await this.authGate.sendInteractionDenial(interaction);
        return { authorized: false, denied: true };
      }
      return { authorized: true };
    } catch (error) {
      this.logger?.error('Unhandled error in InteractionRouter', {
        error: error.message,
        commandName: interaction.commandName || interaction.customId || 'unknown'
      });

      try {
        await replyEphemeral(
          interaction,
          `Internal platform error while processing request: ${error.message}`,
          { explicitSecrets }
        );
      } catch {
        // Ignore secondary reply failure
      }
      return { error: error.message };
    }
  }
}
