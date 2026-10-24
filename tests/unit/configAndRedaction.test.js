import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConfigValidationError,
  loadConfig,
  sanitizeConfigForDisplay
} from '../../src/config/index.js';
import { Logger } from '../../src/logging/logger.js';
import { CREATOR_ATTRIBUTION } from '../../src/utils/constants.js';
import { redactSecrets, redactString } from '../../src/utils/redaction.js';
import { InputValidationError, safeJsonParse } from '../../src/utils/validation.js';
import { makeTestEnv } from '../helpers/mockDiscord.js';

test('Startup config validation refuses missing or non-numeric AUTHORIZED_OPERATOR_ID', () => {
  assert.throws(
    () => loadConfig({ env: makeTestEnv({ AUTHORIZED_OPERATOR_ID: '' }), strict: true }),
    ConfigValidationError
  );

  assert.throws(
    () => loadConfig({ env: makeTestEnv({ AUTHORIZED_OPERATOR_ID: 'Tanveer#0001' }), strict: true }),
    ConfigValidationError
  );

  const nonStrict = loadConfig({
    env: makeTestEnv({ AUTHORIZED_OPERATOR_ID: 'not_a_snowflake' }),
    strict: false
  });
  assert.equal(nonStrict.privilegedEnabled, false);
  assert.equal(nonStrict.validation.valid, false);
});

test('Startup config enforces creator attribution MADE BY TANVEER and redacts secrets in display view', () => {
  // Construct synthetic token shape at runtime so no static token-shaped literal exists in source
  const fakeToken = [
    Buffer.from('1234567890123456789').toString('base64').replace(/=+$/, ''),
    'GhIjKl',
    'MnOpQrStUvWxYz0123456789abcdef'
  ].join('.');
  const cfg = loadConfig({
    env: makeTestEnv({
      DISCORD_TOKEN: fakeToken,
      ENABLE_TELEMETRY_WEBHOOK: 'true',
      TELEMETRY_WEBHOOK_SECRET: 'super_secret_hmac_key_12345'
    }),
    strict: true
  });

  assert.equal(cfg.creatorAttribution, CREATOR_ATTRIBUTION);
  assert.equal(cfg.privilegedEnabled, true);

  const display = sanitizeConfigForDisplay(cfg);
  const serialized = JSON.stringify(display);
  assert.ok(!serialized.includes(fakeToken), 'Token must never appear in sanitized config');
  assert.ok(
    !serialized.includes('super_secret_hmac_key_12345'),
    'Webhook secret must never appear in sanitized config'
  );
  assert.equal(display.discordTokenConfigured, true);
  assert.equal(display.telemetryWebhook.secretConfigured, true);
});

test('Secret redaction scrubs Discord bot tokens, webhook URLs, Bearer headers, and sensitive keys', () => {
  const rawToken = [
    Buffer.from('1234567890123456789').toString('base64').replace(/=+$/, ''),
    'AbCdEf',
    'GhIjKlMnOpQrStUvWxYz1234567890'
  ].join('.');
  const rawWebhook = [
    'https://discord.com/api/webhooks',
    '112233445566778899',
    'secretWebhookTokenAbc123'
  ].join('/');

  const scrubbedText = redactString(
    `Auth failed for DISCORD_TOKEN=${rawToken} and ${rawWebhook} with Bearer mySecretJwt1234567890`
  );
  assert.ok(!scrubbedText.includes(rawToken));
  assert.ok(!scrubbedText.includes('secretWebhookTokenAbc123'));
  assert.ok(!scrubbedText.includes('mySecretJwt1234567890'));
  assert.ok(scrubbedText.includes('[REDACTED]'));

  const circular = { name: 'node' };
  circular.self = circular;
  const obj = {
    discordToken: rawToken,
    webhookSecret: 'my_hmac_secret_value',
    cancellationToken: { isCancelled: false }, // Safe exception key
    nestedError: new Error(`Crashed with token ${rawToken}`),
    circular
  };

  const redactedObj = redactSecrets(obj);
  assert.equal(redactedObj.discordToken, '[REDACTED]');
  assert.equal(redactedObj.webhookSecret, '[REDACTED]');
  assert.deepEqual(redactedObj.cancellationToken, { isCancelled: false });
  assert.ok(!redactedObj.nestedError.message.includes(rawToken));
  assert.equal(redactedObj.circular.self, '[Circular]');

  // Verify Logger never prints explicit secrets
  const captured = [];
  const logger = new Logger({
    level: 'info',
    explicitSecrets: ['custom_astra_secret_98765'],
    sink: (entry, line) => captured.push({ entry, line })
  });
  logger.info('Testing secretcustom_astra_secret_98765 leak', {
    apiKey: 'secret123',
    note: 'custom_astra_secret_98765'
  });
  assert.equal(captured.length, 1);
  assert.ok(!captured[0].line.includes('custom_astra_secret_98765'));
  assert.ok(!captured[0].line.includes('secret123'));
});

test('Untrusted JSON validation rejects prototype pollution and oversized payloads', () => {
  assert.throws(
    () => safeJsonParse('{"__proto__": {"polluted": true}}'),
    InputValidationError
  );
  assert.throws(
    () => safeJsonParse('{"a": 1}', { maxBytes: 4 }),
    InputValidationError
  );
});
