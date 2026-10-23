import { redactSecrets, redactString } from '../utils/redaction.js';

const LEVEL_PRIORITY = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99
});

export class Logger {
  constructor({
    level = 'info',
    explicitSecrets = [],
    context = {},
    sink = null,
    ringBufferSize = 200,
    sharedRingBuffer = null
  } = {}) {
    const normalizedLevel = String(level || 'info').toLowerCase();
    this.level = LEVEL_PRIORITY[normalizedLevel] !== undefined ? normalizedLevel : 'info';
    this.explicitSecrets = Array.isArray(explicitSecrets) ? explicitSecrets.filter(Boolean) : [];
    this.context = context;
    this.sink = sink;
    this.ringBufferSize = ringBufferSize;
    this.recentEntries = sharedRingBuffer || [];
  }

  registerSecret(secretValue) {
    if (typeof secretValue === 'string' && secretValue.trim().length >= 6) {
      if (!this.explicitSecrets.includes(secretValue)) {
        this.explicitSecrets.push(secretValue);
      }
    }
  }

  child(extraContext = {}) {
    return new Logger({
      level: this.level,
      explicitSecrets: this.explicitSecrets,
      context: { ...this.context, ...extraContext },
      sink: this.sink,
      ringBufferSize: this.ringBufferSize,
      sharedRingBuffer: this.recentEntries
    });
  }

  shouldLog(targetLevel) {
    return (LEVEL_PRIORITY[targetLevel] ?? 20) >= (LEVEL_PRIORITY[this.level] ?? 20);
  }

  write(targetLevel, message, meta = {}) {
    const safeMessage = redactString(String(message), this.explicitSecrets);
    const safeMeta = redactSecrets({ ...this.context, ...meta }, this.explicitSecrets);

    const entry = {
      timestamp: new Date().toISOString(),
      level: targetLevel.toUpperCase(),
      message: safeMessage,
      ...(Object.keys(safeMeta).length > 0 ? { meta: safeMeta } : {})
    };

    this.recentEntries.push(entry);
    if (this.recentEntries.length > this.ringBufferSize) {
      this.recentEntries.shift();
    }

    if (!this.shouldLog(targetLevel)) {
      return entry;
    }

    const serialized = JSON.stringify(entry);
    if (typeof this.sink === 'function') {
      this.sink(entry, serialized);
    } else if (targetLevel === 'error' || targetLevel === 'warn') {
      process.stderr.write(`${serialized}\n`);
    } else {
      process.stdout.write(`${serialized}\n`);
    }

    return entry;
  }

  debug(message, meta) {
    return this.write('debug', message, meta);
  }

  info(message, meta) {
    return this.write('info', message, meta);
  }

  warn(message, meta) {
    return this.write('warn', message, meta);
  }

  error(message, meta) {
    return this.write('error', message, meta);
  }

  getRecentEntries(limit = 25) {
    return this.recentEntries.slice(-limit);
  }
}
