/**
 * Untrusted Input Validation & Sanitization Utilities
 * Treats all external/imported data (JSON logs, incident reports, webhooks) as untrusted.
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB max payload
const DEFAULT_MAX_DEPTH = 12;

export class InputValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'InputValidationError';
    this.details = details;
  }
}

/**
 * Safely parses untrusted JSON text while blocking prototype pollution and excessive size/depth.
 */
export function safeJsonParse(rawText, { maxBytes = DEFAULT_MAX_BYTES, maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  if (typeof rawText !== 'string') {
    throw new InputValidationError('Expected JSON payload as a UTF-8 string.');
  }
  const byteLength = Buffer.byteLength(rawText, 'utf8');
  if (byteLength > maxBytes) {
    throw new InputValidationError(`Payload exceeds maximum allowed size (${byteLength} > ${maxBytes} bytes).`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText, (key, val) => {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new InputValidationError(`Forbidden prototype-pollution key "${key}" detected in untrusted JSON.`);
      }
      return val;
    });
  } catch (err) {
    if (err instanceof InputValidationError) {
      throw err;
    }
    throw new InputValidationError(`Malformed JSON input: ${err.message}`);
  }

  assertMaxDepth(parsed, maxDepth, 0);
  return sanitizeObjectGraph(parsed);
}

export function sanitizeObjectGraph(value, maxDepth = DEFAULT_MAX_DEPTH, currentDepth = 0) {
  if (currentDepth > maxDepth) {
    throw new InputValidationError(`Object nesting depth exceeds maximum allowed (${maxDepth}).`);
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string') {
      return sanitizeText(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObjectGraph(item, maxDepth, currentDepth + 1));
  }

  const clean = {};
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new InputValidationError(`Forbidden key "${key}" detected in untrusted object.`);
    }
    clean[sanitizeText(key, 256)] = sanitizeObjectGraph(value[key], maxDepth, currentDepth + 1);
  }
  return clean;
}

function assertMaxDepth(value, maxDepth, depth) {
  if (depth > maxDepth) {
    throw new InputValidationError(`Object nesting depth exceeds maximum allowed (${maxDepth}).`);
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (const item of value) {
        assertMaxDepth(item, maxDepth, depth + 1);
      }
    } else {
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) {
          throw new InputValidationError(`Forbidden key "${key}" detected.`);
        }
        assertMaxDepth(value[key], maxDepth, depth + 1);
      }
    }
  }
}

/**
 * Strips dangerous null/control characters while preserving newlines and tabs, and caps length.
 */
export function sanitizeText(str, maxLength = 8192) {
  if (typeof str !== 'string') {
    throw new InputValidationError('Expected a string value.');
  }
  // Remove C0 control chars except \t (\x09), \n (\x0A), \r (\x0D)
  const cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/**
 * Normalizes an ISO-8601 string or epoch millisecond timestamp to integer epoch ms.
 */
export function parseValidTimestampMs(input, fieldName = 'timestamp') {
  if (typeof input === 'number' && Number.isFinite(input) && input > 946684800000 && input < 4102444800000) {
    return Math.trunc(input);
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    if (/^\d{13}$/.test(input.trim())) {
      return Number.parseInt(input.trim(), 10);
    }
    const parsed = Date.parse(input);
    if (!Number.isNaN(parsed) && parsed > 946684800000 && parsed < 4102444800000) {
      return parsed;
    }
  }
  throw new InputValidationError(`Invalid timestamp in field "${fieldName}".`);
}
