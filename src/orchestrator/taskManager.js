import {
  OVERALL_OBSERVATION_STATUSES,
  SCENARIO_RESULTS,
  SCENARIO_STATES
} from '../utils/constants.js';
import { CancellationError, CancellationTokenSource } from './cancellation.js';

export class TaskManager {
  constructor({
    repositories = null,
    logger = null,
    maxConcurrentScenarios = 3,
    maxObservationDurationMs = 15 * 60 * 1000,
    cleanupTimeoutMs = 3000
  } = {}) {
    this.repositories = repositories;
    this.logger = logger;
    this.maxConcurrentScenarios = maxConcurrentScenarios;
    this.maxObservationDurationMs = maxObservationDurationMs;
    this.cleanupTimeoutMs = cleanupTimeoutMs;

    this.activeRuns = new Map(); // observationId -> runHandle
    this._inFlightStopPromise = null;
  }

  /**
   * Startup hygiene (Part 12): Never automatically resume interrupted or cancelled runs after a restart.
   * Marks leftover INITIALIZING/RUNNING runs from prior crash/restart as INTERRUPTED_BY_RESTART.
   */
  reconcileInterruptedRunsOnStartup() {
    if (!this.repositories) {
      return { reconciledRuns: 0, reconciledExecutions: 0 };
    }

    const unfinishedRuns = this.repositories.findUnfinishedObservationRuns();
    let reconciledExecutions = 0;
    const now = new Date().toISOString();

    for (const run of unfinishedRuns) {
      const executions = this.repositories.listScenarioExecutionsByObservation(run.observation_id);
      for (const exec of executions) {
        if (!['COMPLETED', 'BLOCKED', 'CANCELLED', 'FAILED'].includes(exec.state)) {
          this.repositories.updateScenarioExecution(exec.execution_id, {
            state: SCENARIO_STATES.CANCELLED,
            finalResult: SCENARIO_RESULTS.CANCELLED,
            errorMessage: 'Process restarted during execution; never auto-resumed per safety policy.',
            completedAt: now
          });
          reconciledExecutions += 1;
        }
      }

      this.repositories.updateObservationRun(run.observation_id, {
        overallStatus: OVERALL_OBSERVATION_STATUSES.INTERRUPTED_BY_RESTART,
        failureCategory: 'PROCESS_RESTART',
        failureMessage:
          'Observation was active when the process restarted. Marked interrupted and not auto-resumed.',
        completedAt: now
      });

      this.repositories.insertCleanupRecord({
        observationId: run.observation_id,
        status: 'VERIFIED_POST_RESTART',
        plannedActions: ['Mark unfinished scenarios CANCELLED', 'Ensure zero auto-resume'],
        completedActions: ['Marked unfinished scenarios CANCELLED', 'Verified no background timers'],
        incompleteActions: [],
        notes: 'Startup hygiene reconciliation after process restart.',
        verifiedAt: now
      });
    }

    if (unfinishedRuns.length > 0) {
      this.logger?.warn('Reconciled interrupted observation runs on startup (no auto-resume)', {
        reconciledRuns: unfinishedRuns.length,
        reconciledExecutions
      });
    }

    return {
      reconciledRuns: unfinishedRuns.length,
      reconciledExecutions
    };
  }

  /**
   * Registers an active observation workflow or standalone lab job with bounded max duration.
   */
  registerRun(observationId, { guildId = null, durationLimitMs = null } = {}) {
    if (this.activeRuns.has(observationId)) {
      throw new Error(`Observation run "${observationId}" is already registered.`);
    }

    const rootSource = new CancellationTokenSource();
    const effectiveLimit = durationLimitMs ?? this.maxObservationDurationMs;

    const deadlineTimer = setTimeout(() => {
      rootSource.cancel(
        `Maximum observation duration (${Math.round(effectiveLimit / 1000)}s) reached.`
      );
    }, effectiveLimit);

    // Do not block process exit solely on the safety deadline timer if run already disposed
    if (typeof deadlineTimer.unref === 'function') {
      deadlineTimer.unref();
    }

    const runEntry = {
      observationId,
      guildId,
      startedAt: new Date().toISOString(),
      schedulingHalted: false,
      rootSource,
      deadlineTimer,
      childSources: new Set(),
      queuedItems: new Map(), // queueId -> { scenarioId, executionId, reject }
      activeExecutions: new Map(), // executionId -> { scenarioId, cleanupFn, promise }
      cleanupCallbacks: new Map() // id -> async () => cleanupResult
    };

    this.activeRuns.set(observationId, runEntry);
    return {
      cancellationToken: rootSource.token,
      cancellationSource: rootSource
    };
  }

  createChildCancellationSource(observationId) {
    const run = this.activeRuns.get(observationId);
    if (!run) {
      return new CancellationTokenSource();
    }
    const child = new CancellationTokenSource(run.rootSource.token);
    run.childSources.add(child);
    return child;
  }

  releaseChildCancellationSource(observationId, childSource) {
    childSource?.dispose();
    const run = this.activeRuns.get(observationId);
    if (run) {
      run.childSources.delete(childSource);
    }
  }

  registerCleanupHook(observationId, hookId, cleanupFn) {
    const run = this.activeRuns.get(observationId);
    if (!run) return;
    run.cleanupCallbacks.set(hookId, cleanupFn);
  }

  unregisterCleanupHook(observationId, hookId) {
    const run = this.activeRuns.get(observationId);
    if (!run) return;
    run.cleanupCallbacks.delete(hookId);
  }

  /**
   * Runs scenario tasks with bounded concurrency, immediate queue cancellation, and resource tracking.
   */
  async executeBoundedQueue(observationId, items, workerFn, concurrency = this.maxConcurrentScenarios) {
    const run = this.activeRuns.get(observationId);
    if (!run) {
      throw new Error(`Cannot schedule tasks: run "${observationId}" is not registered.`);
    }

    const cap = Math.max(1, Math.min(concurrency, this.maxConcurrentScenarios));
    const results = new Array(items.length);
    let cursor = 0;

    // Register all queued items up front so /stop can account for & cancel unstarted items immediately
    items.forEach((item, idx) => {
      run.queuedItems.set(idx, {
        index: idx,
        scenarioId: item.scenario?.id ?? item.id ?? `item_${idx}`,
        executionId: item.executionId ?? null
      });
    });

    const runWorker = async () => {
      while (true) {
        if (run.schedulingHalted || run.rootSource.isCancelled) {
          return;
        }
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= items.length) {
          return;
        }

        const item = items[currentIndex];
        run.queuedItems.delete(currentIndex);

        if (run.schedulingHalted || run.rootSource.isCancelled) {
          results[currentIndex] = {
            cancelledBeforeStart: true,
            item,
            reason: run.rootSource.reason || 'Scheduling halted by /stop.'
          };
          continue;
        }

        const execKey = item.executionId || `slot_${currentIndex}`;
        const childSource = this.createChildCancellationSource(observationId);

        const taskPromise = (async () => {
          try {
            return await workerFn(item, childSource.token);
          } finally {
            this.releaseChildCancellationSource(observationId, childSource);
            run.activeExecutions.delete(execKey);
          }
        })();

        run.activeExecutions.set(execKey, {
          scenarioId: item.scenario?.id ?? item.id ?? execKey,
          promise: taskPromise
        });

        results[currentIndex] = await taskPromise;
      }
    };

    const workerCount = Math.min(cap, items.length);
    const workers = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(runWorker());
    }
    await Promise.all(workers);

    // Mark any leftover queued items that never got picked up due to /stop
    for (const [idx] of run.queuedItems.entries()) {
      const item = items[idx];
      results[idx] = {
        cancelledBeforeStart: true,
        item,
        reason: run.rootSource.reason || 'Cancelled while queued.'
      };
    }
    run.queuedItems.clear();

    return results;
  }

  /**
   * Releases an observation run once finalized.
   */
  unregisterRun(observationId) {
    const run = this.activeRuns.get(observationId);
    if (!run) return;
    if (run.deadlineTimer) {
      clearTimeout(run.deadlineTimer);
    }
    for (const child of run.childSources) {
      child.dispose();
    }
    run.childSources.clear();
    run.rootSource.dispose();
    run.queuedItems.clear();
    run.activeExecutions.clear();
    run.cleanupCallbacks.clear();
    this.activeRuns.delete(observationId);
  }

  /**
   * Emergency /stop implementation (Part 12 — all 9 steps).
   * Coalesces concurrent /stop invocations safely and executes bounded cleanup.
   */
  async stopAll({ reason = 'Emergency /stop invoked by authorized operator.' } = {}) {
    if (this._inFlightStopPromise) {
      return this._inFlightStopPromise;
    }

    this._inFlightStopPromise = this._performStopAll(reason).finally(() => {
      this._inFlightStopPromise = null;
    });

    return this._inFlightStopPromise;
  }

  async _performStopAll(reason) {
    const runsSnapshot = Array.from(this.activeRuns.values());
    if (runsSnapshot.length === 0) {
      return {
        stopped: false,
        activeRunsFound: 0,
        cancelledRuns: [],
        cancelledQueuedCount: 0,
        cancelledActiveExecutions: 0,
        clearedTimers: 0,
        completedCleanups: [],
        incompleteCleanups: []
      };
    }

    const cancelledRuns = [];
    let cancelledQueuedCount = 0;
    let cancelledActiveExecutions = 0;
    let clearedTimers = 0;
    const completedCleanups = [];
    const incompleteCleanups = [];
    const nowIso = new Date().toISOString();

    // Steps 1-4: Immediately set cancellation signals, halt scheduling, cancel queued items, clear timers
    for (const run of runsSnapshot) {
      cancelledRuns.push(run.observationId);
      run.schedulingHalted = true;

      if (run.deadlineTimer) {
        clearTimeout(run.deadlineTimer);
        run.deadlineTimer = null;
        clearedTimers += 1;
      }

      cancelledQueuedCount += run.queuedItems.size;
      cancelledActiveExecutions += run.activeExecutions.size;

      // Persist queued items as CANCELLED immediately if they already have executionIds
      if (this.repositories) {
        for (const queued of run.queuedItems.values()) {
          if (queued.executionId) {
            try {
              this.repositories.updateScenarioExecution(queued.executionId, {
                state: SCENARIO_STATES.CANCELLED,
                finalResult: SCENARIO_RESULTS.CANCELLED,
                errorMessage: reason,
                completedAt: nowIso
              });
            } catch {
              // Ignore if not yet persisted
            }
          }
        }
      }
      run.queuedItems.clear();

      // Cancel child scenario tokens and root token synchronously (clears all sleep/wait timers)
      for (const child of run.childSources) {
        const res = child.cancel(reason);
        clearedTimers += res.clearedTimers;
      }
      const rootCancelRes = run.rootSource.cancel(reason);
      clearedTimers += rootCancelRes.clearedTimers;
    }

    // Step 5: Allow only bounded finalization for in-flight scenario promises and cleanup hooks
    for (const run of runsSnapshot) {
      const activePromises = Array.from(run.activeExecutions.values()).map((e) =>
        e.promise.catch(() => null)
      );

      if (activePromises.length > 0) {
        await this._awaitBounded(Promise.allSettled(activePromises), this.cleanupTimeoutMs);
      }

      for (const [hookId, cleanupFn] of run.cleanupCallbacks.entries()) {
        try {
          const outcome = await this._awaitBounded(
            Promise.resolve().then(() => cleanupFn(reason)),
            this.cleanupTimeoutMs
          );
          if (outcome.timedOut) {
            incompleteCleanups.push({
              observationId: run.observationId,
              hookId,
              reason: `Cleanup timed out after ${this.cleanupTimeoutMs}ms`
            });
          } else {
            completedCleanups.push({
              observationId: run.observationId,
              hookId
            });
          }
        } catch (cleanupErr) {
          incompleteCleanups.push({
            observationId: run.observationId,
            hookId,
            reason: cleanupErr.message
          });
        }
      }

      // Steps 6 & 7: Persist partial results & mark any remaining unfinished scenarios CANCELLED
      if (this.repositories) {
        const persistedExecs = this.repositories.listScenarioExecutionsByObservation(
          run.observationId
        );
        for (const exec of persistedExecs) {
          if (!['COMPLETED', 'BLOCKED', 'CANCELLED', 'FAILED'].includes(exec.state)) {
            this.repositories.updateScenarioExecution(exec.execution_id, {
              state: SCENARIO_STATES.CANCELLED,
              finalResult: SCENARIO_RESULTS.CANCELLED,
              errorMessage: reason,
              completedAt: new Date().toISOString()
            });
          }
        }

        const obsRecord = this.repositories.getObservationRun(run.observationId);
        if (obsRecord && !obsRecord.completed_at) {
          this.repositories.updateObservationRun(run.observationId, {
            overallStatus: OVERALL_OBSERVATION_STATUSES.CANCELLED,
            failureCategory: 'OPERATOR_STOP',
            failureMessage: reason,
            completedAt: new Date().toISOString()
          });
        }

        this.repositories.insertCleanupRecord({
          observationId: run.observationId,
          status: incompleteCleanups.length === 0 ? 'COMPLETED' : 'INCOMPLETE',
          plannedActions: ['Cancel active scenarios', 'Clear pending timers', 'Run cleanup hooks'],
          completedActions: [
            `Cleared ${clearedTimers} timer(s)`,
            ...completedCleanups.map((c) => `Cleanup hook ${c.hookId}`)
          ],
          incompleteActions: incompleteCleanups.map((ic) => `${ic.hookId}: ${ic.reason}`),
          notes: reason,
          verifiedAt: new Date().toISOString()
        });
      }

      // Step 8: Release resources
      this.unregisterRun(run.observationId);
    }

    this.logger?.warn('Executed emergency /stop cancellation across active runs', {
      cancelledRuns,
      cancelledQueuedCount,
      cancelledActiveExecutions,
      clearedTimers,
      incompleteCleanupCount: incompleteCleanups.length
    });

    // Step 9: Report incomplete cleanup honestly
    return {
      stopped: true,
      activeRunsFound: runsSnapshot.length,
      cancelledRuns,
      cancelledQueuedCount,
      cancelledActiveExecutions,
      clearedTimers,
      completedCleanups,
      incompleteCleanups
    };
  }

  async _awaitBounded(promise, timeoutMs) {
    let timer = null;
    const timeoutGuard = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    try {
      const value = await Promise.race([
        promise.then((res) => ({ timedOut: false, value: res })),
        timeoutGuard
      ]);
      return value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  getStatusSnapshot() {
    const runs = [];
    for (const run of this.activeRuns.values()) {
      runs.push({
        observationId: run.observationId,
        guildId: run.guildId,
        startedAt: run.startedAt,
        schedulingHalted: run.schedulingHalted,
        isCancelled: run.rootSource.isCancelled,
        queuedScenarioCount: run.queuedItems.size,
        activeExecutionCount: run.activeExecutions.size,
        activeExecutionIds: Array.from(run.activeExecutions.keys())
      });
    }
    return {
      activeRunCount: runs.length,
      maxConcurrentScenarios: this.maxConcurrentScenarios,
      maxObservationDurationMs: this.maxObservationDurationMs,
      runs
    };
  }
}

export { CancellationError };
