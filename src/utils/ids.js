import crypto from 'node:crypto';

const SNOWFLAKE_REGEX = /^\d{17,20}$/;

/**
 * Validates that a value is strictly a numeric Discord Snowflake ID (17-20 digits).
 * Never accepts usernames, mentions (<@123>), roles, or non-string/non-digit inputs.
 */
export function isValidSnowflake(value) {
  if (typeof value !== 'string') {
    return false;
  }
  return SNOWFLAKE_REGEX.test(value);
}

/**
 * Generates a unique, sortable, collision-resistant prefixed identifier.
 */
export function generateId(prefix = 'id') {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString('hex');
  return `${prefix}_${ts}_${rand}`;
}

/**
 * Computes a SHA-256 hex digest over canonical string or JSON-serializable content.
 */
export function sha256Hex(input) {
  const serialized = typeof input === 'string' ? input : canonicalJson(input);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * Produces deterministic JSON serialization with sorted object keys for integrity hashing.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
  return `{${entries.join(',')}}`;
}
