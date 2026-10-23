import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_OPERATOR_ID } from '../../src/utils/constants.js';

export function createMockDiscordClient({
  dmShouldFail = false,
  ready = true,
  selfBotId = '123456789012345678'
} = {}) {
  const emitter = new EventEmitter();
  const sentDms = [];

  const client = Object.assign(emitter, {
    user: { id: selfBotId, tag: 'TanveerBetaNewker#0001' },
    options: {
      intents: ['Guilds', 'GuildModeration', 'GuildWebhooks', 'GuildMessages', 'DirectMessages']
    },
    isReady() {
      return ready;
    },
    users: {
      async fetch(userId) {
        if (dmShouldFail) {
          const err = new Error('Cannot send messages to this user');
          err.code = 50007;
          throw err;
        }
        return {
          id: userId,
          async send(payload) {
            sentDms.push({ recipientId: userId, payload });
            return { id: `dm_${sentDms.length}` };
          }
        };
      }
    },
    async login() {
      return 'LOGGED_IN';
    },
    async destroy() {
      emitter.removeAllListeners();
    },
    getSentDms() {
      return [...sentDms];
    }
  });

  return client;
}

export function createMockGuild({
  id = '777777777777777777',
  name = 'Astra Security Lab Guild',
  botPermissions = [
    'ViewChannel',
    'ViewAuditLog',
    'ReadMessageHistory',
    'SendMessages',
    'EmbedLinks',
    'AttachFiles'
  ],
  installedBots = [],
  channelCount = 12,
  roleCount = 8
} = {}) {
  return {
    id,
    name,
    botPermissions,
    installedBots,
    channelCount,
    roleCount
  };
}

export function createMockCommandInteraction({
  commandName,
  userId = DEFAULT_OPERATOR_ID,
  username = 'tanveer_operator',
  guild = createMockGuild(),
  stringOptions = {},
  intOptions = {}
} = {}) {
  const replies = [];
  const edits = [];
  const followUps = [];

  return {
    commandName,
    guildId: guild?.id || null,
    channelId: guild ? '888888888888888888' : null,
    guild,
    user: {
      id: userId,
      username
    },
    deferred: false,
    replied: false,
    options: {
      getString(key) {
        return stringOptions[key] ?? null;
      },
      getInteger(key) {
        return intOptions[key] ?? null;
      }
    },
    isChatInputCommand() {
      return true;
    },
    isButton() {
      return false;
    },
    isStringSelectMenu() {
      return false;
    },
    isModalSubmit() {
      return false;
    },
    async deferReply(payload) {
      this.deferred = true;
      replies.push({ type: 'deferReply', payload });
    },
    async reply(payload) {
      this.replied = true;
      replies.push({ type: 'reply', payload });
      return payload;
    },
    async editReply(payload) {
      edits.push(payload);
      return payload;
    },
    async followUp(payload) {
      followUps.push(payload);
      return payload;
    },
    getTranscript() {
      return { replies, edits, followUps };
    }
  };
}

export function createMockComponentInteraction({
  customId,
  kind = 'button',
  userId = DEFAULT_OPERATOR_ID,
  guild = createMockGuild()
} = {}) {
  const replies = [];
  return {
    customId,
    guildId: guild?.id || null,
    channelId: guild ? '888888888888888888' : null,
    guild,
    user: { id: userId },
    deferred: false,
    replied: false,
    isChatInputCommand() {
      return false;
    },
    isButton() {
      return kind === 'button';
    },
    isStringSelectMenu() {
      return kind === 'select';
    },
    isModalSubmit() {
      return kind === 'modal';
    },
    async reply(payload) {
      this.replied = true;
      replies.push(payload);
      return payload;
    },
    async editReply(payload) {
      replies.push(payload);
      return payload;
    },
    async followUp(payload) {
      replies.push(payload);
      return payload;
    },
    getReplies() {
      return [...replies];
    }
  };
}

export function makeTestEnv(overrides = {}) {
  const tmpArchive = path.join(
    os.tmpdir(),
    `tkbn-exports-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  return {
    AUTHORIZED_OPERATOR_ID: DEFAULT_OPERATOR_ID,
    DISCORD_TOKEN: '',
    DISCORD_CLIENT_ID: '123456789012345678',
    DEV_GUILD_ID: '777777777777777777',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    SIMULATION_MODE: 'true',
    REQUIRE_TEST_GUILD_ALLOWLIST: 'true',
    MAX_CONCURRENT_SCENARIOS: '3',
    MAX_OBSERVATION_DURATION_MINUTES: '15',
    REPORT_ARCHIVE_DIR: tmpArchive,
    ...overrides
  };
}
