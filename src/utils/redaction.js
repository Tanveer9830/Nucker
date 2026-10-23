/**
 * Secret Redaction Engine
 * Scrubs bot tokens, webhook tokens, HMAC secrets, Authorization headers,
 * and sensitive object fields before logging, auditing, or persisting.
 */

const DISCORD_BOT_TOKEN_PATTERN = /\b[MN][A-Za-z\d_-]{22,}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{25,}\b/g;
const DISCORD_MFA_TOKEN_PATTERN = /\bmfa\.[A-Za-z\d_-]{60,}\b/g;
const DISCORD_WEBHOOK_URL_PATTERN = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z\d_-]+/gi;
const BEARER_PATTERN = /\b(Bearer|Bot)\s+[A-Za-z\d._~+/=-]{16,}/gi;
const ENV_SECRET_ASSIGNMENT_PATTERN = /\b(DISCORD_TOKEN|TELEMETRY_WEBHOOK_SECRET|API_KEY|CLIENT_SECRET|PASSWORD)\s*=\s*([^\s"']+)/gi;

const SENSITIVE_KEY_PATTERN = /(token|secret|password|passwd|authorization|api[_-]?key|private[_-]?key|credential|signature)/i;
const SAFE_KEY_EXCEPTIONS = new Set([
  'cancellationToken',
  'tokenCount',
  'hasToken',
  'tokenConfigured',
  'secretConfigured',
  'signatureVerified'
]);

const REDACTED_MARKER = '[REDACTED]';

export function redactString(input, explicitSecrets = []) {
  if (typeof input !== 'string' || input.length === 0) {
    return input;
  }

  let output = input;

  for (const secret of explicitSecrets) {
    if (typeof secret === 'string' && secret.trim().length >= 6) {
      output = output.split(secret).join(REDACTED_MARKER);
    }
  }

  output = output
    .replace(DISCORD_WEBHOOK_URL_PATTERN, 'https://discord.com/api/webhooks/[REDACTED]')
    .replace(DISCORD_BOT_TOKEN_PATTERN, REDACTED_MARKER)
    .replace(DISCORD_MFA_TOKEN_PATTERN, REDACTED_MARKER)
    .replace(BEARER_PATTERN, '$1 [REDACTED]')
    .replace(ENV_SECRET_ASSIGNMENT_PATTERN, '$1=[REDACTED]');

  return output;
}

export function redactSecrets(value, explicitSecrets = [], seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactString(value, explicitSecrets);
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message || '', explicitSecrets),
      code: value.code ?? undefined,
      stack: value.stack ? redactString(value.stack, explicitSecrets) : undefined
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, explicitSecrets, seen));
  }

  const redacted = {};
  for (const [key, propVal] of Object.entries(value)) {
    if (!SAFE_KEY_EXCEPTIONS.has(key) && SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = propVal ? REDACTED_MARKER : propVal;
    } else {
      redacted[key] = redactSecrets(propVal, explicitSecrets, seen);
    }
  }
  return redacted;
}
