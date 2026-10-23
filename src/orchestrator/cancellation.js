export class CancellationError extends Error {
  constructor(reason = 'Operation cancelled by operator /stop.') {
    super(reason);
    this.name = 'CancellationError';
    this.isCancellation = true;
  }
}

export class CancellationToken {
  constructor(source) {
    this._source = source;
  }

  get isCancelled() {
    return this._source.isCancelled;
  }

  get reason() {
    return this._source.reason;
  }

  get cancelledAt() {
    return this._source.cancelledAt;
  }

  throwIfCancelled() {
    if (this._source.isCancelled) {
      throw new CancellationError(this._source.reason);
    }
  }

  onCancel(listener) {
    return this._source.onCancel(listener);
  }

  sleep(ms) {
    return this._source.sleep(ms);
  }
}

export class CancellationTokenSource {
  constructor(parentToken = null) {
    this.isCancelled = false;
    this.reason = null;
    this.cancelledAt = null;
    this._listeners = new Set();
    this._timers = new Map(); // timerHandle -> rejectFn
    this._parentUnsub = null;
    this.token = new CancellationToken(this);

    if (parentToken) {
      if (parentToken.isCancelled) {
        this.cancel(parentToken.reason || 'Parent operation cancelled.');
      } else {
        this._parentUnsub = parentToken.onCancel((reason) => {
          this.cancel(reason);
        });
      }
    }
  }

  onCancel(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    if (this.isCancelled) {
      try {
        listener(this.reason);
      } catch {
        // Ignore listener error during immediate dispatch
      }
      return () => {};
    }
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  sleep(ms) {
    if (this.isCancelled) {
      return Promise.reject(new CancellationError(this.reason));
    }
    const duration = Math.max(0, Number(ms) || 0);
    return new Promise((resolve, reject) => {
      const handle = setTimeout(() => {
        this._timers.delete(handle);
        if (this.isCancelled) {
          reject(new CancellationError(this.reason));
        } else {
          resolve();
        }
      }, duration);

      this._timers.set(handle, reject);
    });
  }

  cancel(reason = 'Cancelled by operator /stop command.') {
    if (this.isCancelled) {
      return {
        alreadyCancelled: true,
        clearedTimers: 0,
        cancelledAt: this.cancelledAt
      };
    }

    this.isCancelled = true;
    this.reason = reason;
    this.cancelledAt = new Date().toISOString();

    if (this._parentUnsub) {
      this._parentUnsub();
      this._parentUnsub = null;
    }

    // Cancel and clear all pending timers immediately
    const clearedTimers = this._timers.size;
    for (const [handle, rejectFn] of this._timers.entries()) {
      clearTimeout(handle);
      try {
        rejectFn(new CancellationError(this.reason));
      } catch {
        // Ignore secondary rejection error
      }
    }
    this._timers.clear();

    const listeners = Array.from(this._listeners);
    this._listeners.clear();
    for (const listener of listeners) {
      try {
        listener(this.reason);
      } catch {
        // Isolate listener exceptions
      }
    }

    return {
      alreadyCancelled: false,
      clearedTimers,
      cancelledAt: this.cancelledAt
    };
  }

  get activeTimerCount() {
    return this._timers.size;
  }

  dispose() {
    if (this._parentUnsub) {
      this._parentUnsub();
      this._parentUnsub = null;
    }
    for (const [handle] of this._timers.entries()) {
      clearTimeout(handle);
    }
    this._timers.clear();
    this._listeners.clear();
  }
}
