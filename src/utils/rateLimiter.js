/**
 * Rate-Limit-Aware Request Executor
 * Never bypasses Discord rate limits: strictly honors 429 retry_after / Retry-After headers,
 * applies bounded exponential backoff for transient 5xx/network errors, enforces request timeouts,
 * and aborts immediately when a CancellationToken is cancelled.
 */

export class RateLimitExhaustedError extends Error {
  constructor(message, retryAfterMs, attempts) {
    super(message);
    this.name = 'RateLimitExhaustedError';
    this.retryAfterMs = retryAfterMs;
    this.attempts = attempts;
  }
}

export class RequestTimeoutError extends Error {
  constructor(message, timeoutMs) {
    super(message);
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class RateLimitAwareExecutor {
  constructor({
    maxRetries = 3,
    defaultTimeoutMs = 10000,
    baseBackoffMs = 250,
    maxBackoffMs = 15000,
    sleepFn = null,
    logger = null
  } = {}) {
    this.maxRetries = maxRetries;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.baseBackoffMs = baseBackoffMs;
    this.maxBackoffMs = maxBackoffMs;
    this.sleepFn = sleepFn;
    this.logger = logger;
    this.stats = {
      totalRequests: 0,
      succeededRequests: 0,
      rateLimitedCount: 0,
      transientRetryCount: 0,
      failedRequests: 0,
      timedOutCount: 0
    };
  }

  extractRetryAfterMs(error) {
    if (!error || typeof error !== 'object') {
      return null;
    }
    // Discord.js RateLimitError / REST error shapes
    if (typeof error.retryAfter === 'number' && Number.isFinite(error.retryAfter)) {
      return error.retryAfter < 100 ? Math.ceil(error.retryAfter * 1000) : Math.ceil(error.retryAfter);
    }
    if (typeof error.timeToReset === 'number' && Number.isFinite(error.timeToReset)) {
      return Math.max(50, Math.ceil(error.timeToReset));
    }
    const rawRetry = error.rawError?.retry_after ?? error.data?.retry_after;
    if (typeof rawRetry === 'number' && Number.isFinite(rawRetry)) {
      return Math.max(50, Math.ceil(rawRetry * 1000));
    }
    const headerVal = error.headers?.['retry-after'] ?? error.headers?.get?.('retry-after');
    if (headerVal !== undefined && headerVal !== null) {
      const numeric = Number(headerVal);
      if (Number.isFinite(numeric)) {
        return Math.max(50, Math.ceil(numeric * 1000));
      }
    }
    return null;
  }

  isRateLimitError(error) {
    return Boolean(
      error &&
        (error.status === 429 ||
          error.httpStatus === 429 ||
          error.code === 429 ||
          error.name === 'RateLimitError')
    );
  }

  isTransientServerError(error) {
    if (!error) return false;
    const status = error.status ?? error.httpStatus;
    if (typeof status === 'number' && status >= 500 && status <= 599) {
      return true;
    }
    return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.code);
  }

  async waitWithCancellation(ms, cancellationToken) {
    if (cancellationToken) {
      cancellationToken.throwIfCancelled();
      if (typeof cancellationToken.sleep === 'function') {
        await cancellationToken.sleep(ms);
        return;
      }
    }
    if (this.sleepFn) {
      await this.sleepFn(ms);
      return;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (cancellationToken && typeof cancellationToken.onCancel === 'function') {
        const unsub = cancellationToken.onCancel((reason) => {
          clearTimeout(timer);
          unsub?.();
          const err = new Error(reason || 'Operation cancelled');
          err.name = 'CancellationError';
          reject(err);
        });
      }
    });
  }

  async runWithTimeout(fn, timeoutMs, cancellationToken) {
    if (cancellationToken) {
      cancellationToken.throwIfCancelled();
    }
    let timer = null;
    let unsub = null;

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        this.stats.timedOutCount += 1;
        reject(new RequestTimeoutError(`Operation timed out after ${timeoutMs}ms`, timeoutMs));
      }, timeoutMs);

      if (cancellationToken && typeof cancellationToken.onCancel === 'function') {
        unsub = cancellationToken.onCancel((reason) => {
          clearTimeout(timer);
          const err = new Error(reason || 'Operation cancelled');
          err.name = 'CancellationError';
          reject(err);
        });
      }
    });

    try {
      return await Promise.race([Promise.resolve().then(() => fn()), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      if (unsub) unsub();
    }
  }

  async execute(fn, { label = 'discord-op', timeoutMs = this.defaultTimeoutMs, cancellationToken = null } = {}) {
    let attempt = 0;

    while (true) {
      if (cancellationToken) {
        cancellationToken.throwIfCancelled();
      }
      attempt += 1;
      this.stats.totalRequests += 1;

      try {
        const result = await this.runWithTimeout(fn, timeoutMs, cancellationToken);
        this.stats.succeededRequests += 1;
        return result;
      } catch (error) {
        if (error?.name === 'CancellationError') {
          throw error;
        }

        if (this.isRateLimitError(error)) {
          this.stats.rateLimitedCount += 1;
          const requestedWait = this.extractRetryAfterMs(error) ?? this.baseBackoffMs * Math.pow(2, attempt - 1);
          const boundedWait = Math.min(requestedWait, this.maxBackoffMs);

          if (attempt > this.maxRetries || requestedWait > this.maxBackoffMs) {
            this.stats.failedRequests += 1;
            throw new RateLimitExhaustedError(
              `Rate limit persisted for "${label}" after ${attempt} attempt(s) (retry_after=${requestedWait}ms).`,
              requestedWait,
              attempt
            );
          }

          this.logger?.warn('Respecting rate limit retry_after delay', {
            label,
            attempt,
            waitMs: boundedWait
          });
          await this.waitWithCancellation(boundedWait, cancellationToken);
          continue;
        }

        if (this.isTransientServerError(error) && attempt <= this.maxRetries) {
          this.stats.transientRetryCount += 1;
          const backoff = Math.min(this.baseBackoffMs * Math.pow(2, attempt - 1), this.maxBackoffMs);
          this.logger?.warn('Transient upstream error; retrying within bounded policy', {
            label,
            attempt,
            backoffMs: backoff,
            errorName: error.name,
            status: error.status ?? error.httpStatus
          });
          await this.waitWithCancellation(backoff, cancellationToken);
          continue;
        }

        this.stats.failedRequests += 1;
        throw error;
      }
    }
  }

  getHealthSnapshot() {
    return { ...this.stats };
  }
}
