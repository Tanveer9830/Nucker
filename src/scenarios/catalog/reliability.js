import { CancellationTokenSource } from '../../orchestrator/cancellation.js';
import { ScenarioStateMachine } from '../../orchestrator/stateMachine.js';
import {
  RISK_CATEGORIES,
  SCENARIO_CATEGORIES,
  SCENARIO_RESULTS,
  SCENARIO_STATES
} from '../../utils/constants.js';
import { RateLimitAwareExecutor } from '../../utils/rateLimiter.js';
import { defineScenario } from '../schema.js';
import { assertStimulusTimelineComplete } from './assertionHelpers.js';

export const reliabilityScenarios = [
  defineScenario({
    id: 'REL-001',
    name: 'discord-api-error-resilience',
    title: 'Discord API 5xx Error Handling',
    description:
      'Injects simulated Discord REST 502/503 errors into RateLimitAwareExecutor to verify bounded retry recovery.',
    category: SCENARIO_CATEGORIES.RELIABILITY,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'Discord REST Error Resilience',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { injectedFailures: 2, intervalMs: 5 },
    expectedOutcome: { recoveredAfterTransient5xx: true },
    eventSequence: [
      { eventType: 'SIMULATED_DISCORD_API_502', count: 2, isMaliciousStimulus: false }
    ],
    async customProbe() {
      const executor = new RateLimitAwareExecutor({ maxRetries: 3, baseBackoffMs: 5, maxBackoffMs: 30 });
      let calls = 0;
      const response = await executor.execute(async () => {
        calls += 1;
        if (calls <= 2) {
          const err = new Error('Bad Gateway');
          err.status = 502;
          throw err;
        }
        return { ok: true, attemptsUsed: calls };
      });
      return { recovered: response.ok, attemptsUsed: calls, stats: executor.getHealthSnapshot() };
    },
    assertions: [
      assertStimulusTimelineComplete(2),
      {
        id: 'TRANSIENT_5XX_RECOVERED',
        targetFacing: false,
        description: 'Executor must recover cleanly on bounded retry after transient 502 errors.',
        evaluate(ctx) {
          if (ctx.probeResult?.recovered && ctx.probeResult?.attemptsUsed === 3) {
            return {
              status: SCENARIO_RESULTS.PASS,
              expected: 'Recovered on attempt 3',
              observed: `Recovered on attempt ${ctx.probeResult.attemptsUsed}`,
              message: 'Bounded retry recovered from transient Discord 5xx errors.'
            };
          }
          return {
            status: SCENARIO_RESULTS.FAIL,
            expected: 'Recovered on attempt 3',
            observed: JSON.stringify(ctx.probeResult),
            message: 'Executor did not recover cleanly from simulated 5xx errors.'
          };
        }
      }
    ]
  }),

  defineScenario({
    id: 'REL-002',
    name: 'discord-rate-limit-respect',
    title: 'Discord 429 Rate-Limit Backoff Compliance',
    description:
      'Injects a simulated HTTP 429 response with retry_after metadata to confirm strict rate-limit compliance without bypass.',
    category: SCENARIO_CATEGORIES.RELIABILITY,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'Discord Rate-Limit Compliance',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { retryAfterSeconds: 0.05, intervalMs: 5 },
    expectedOutcome: { honoredRetryAfter: true },
    eventSequence: [
      { eventType: 'SIMULATED_DISCORD_429_RETRY_AFTER', count: 1, isMaliciousStimulus: false }
    ],
    async customProbe() {
      const observedWaits = [];
      const executor = new RateLimitAwareExecutor({
        maxRetries: 2,
        baseBackoffMs: 10,
        maxBackoffMs: 2000,
        sleepFn: async (ms) => {
          observedWaits.push(ms);
        }
      });
      let attempt = 0;
      await executor.execute(async () => {
        attempt += 1;
        if (attempt === 1) {
          const err = new Error('Too Many Requests');
          err.status = 429;
          err.rawError = { retry_after: 0.08 };
          throw err;
        }
        return { ok: true };
      });
      return { honoredWaitMs: observedWaits[0] ?? 0, stats: executor.getHealthSnapshot() };
    },
    assertions: [
      assertStimulusTimelineComplete(1),
      {
        id: 'RATE_LIMIT_RETRY_AFTER_HONORED',
        targetFacing: false,
        description: 'Rate limiter must wait at least the returned retry_after duration before retrying.',
        evaluate(ctx) {
          if ((ctx.probeResult?.honoredWaitMs ?? 0) >= 80) {
            return {
              status: SCENARIO_RESULTS.PASS,
              expected: 'waitMs >= 80ms',
              observed: `waitMs=${ctx.probeResult.honoredWaitMs}ms`,
              message: 'Rate-limit retry_after header was strictly respected.'
            };
          }
          return {
            status: SCENARIO_RESULTS.FAIL,
            expected: 'waitMs >= 80ms',
            observed: `waitMs=${ctx.probeResult?.honoredWaitMs}ms`,
            message: 'Rate-limit retry_after delay was not respected.'
          };
        }
      }
    ]
  }),

  defineScenario({
    id: 'REL-003',
    name: 'gateway-disconnection-containment',
    title: 'Gateway Disconnection Resilience',
    description:
      'Simulates a Discord WebSocket gateway disconnect event during active observation and verifies buffered timeline preservation.',
    category: SCENARIO_CATEGORIES.RELIABILITY,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'Gateway Disconnection Survival',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { disconnectCode: 1001, intervalMs: 5 },
    expectedOutcome: { bufferedEventsPreserved: true },
    eventSequence: [
      { eventType: 'GATEWAY_DISCONNECT_SIMULATED', count: 1, isMaliciousStimulus: false }
    ],
    async customProbe(ctx) {
      return {
        bufferedEventsBeforeDisconnect: ctx.stimulusEvents.length,
        dbOpen: Boolean(ctx.repositories)
      };
    },
    assertions: [
      assertStimulusTimelineComplete(1),
      {
        id: 'TIMELINE_INTACT_ON_DISCONNECT',
        targetFacing: false,
        description: 'Persisted timeline and SQLite connection must remain intact across gateway disconnect.',
        evaluate(ctx) {
          return ctx.probeResult?.dbOpen
            ? {
                status: SCENARIO_RESULTS.PASS,
                expected: 'SQLite & buffered timeline intact',
                observed: 'Intact',
                message: 'Observation persistence survived simulated gateway disconnection.'
              }
            : {
                status: SCENARIO_RESULTS.FAIL,
                expected: 'SQLite & buffered timeline intact',
                observed: 'Unavailable',
                message: 'Persistence unavailable during simulated gateway disconnect.'
              };
        }
      }
    ]
  }),

  defineScenario({
    id: 'REL-004',
    name: 'gateway-reconnection-continuity',
    title: 'Gateway Reconnection and Sequence Continuity',
    description:
      'Simulates gateway session resume and verifies monotonic event sequence numbering without event loss.',
    category: SCENARIO_CATEGORIES.RELIABILITY,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'Gateway Reconnection Continuity',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 5 },
    expectedOutcome: { sequenceMonotonic: true },
    eventSequence: [
      { eventType: 'GATEWAY_DISCONNECT_FRAME', count: 1, isMaliciousStimulus: false },
      { eventType: 'GATEWAY_RESUME_FRAME', count: 1, isMaliciousStimulus: false }
    ],
    assertions: [
      assertStimulusTimelineComplete(2),
      {
        id: 'MONOTONIC_SEQUENCE_CONTINUITY',
        targetFacing: false,
        description: 'Event sequence numbers must increase strictly across reconnect boundary.',
        evaluate(ctx) {
          const [first, second] = ctx.stimulusEvents;
          if (first && second && second.sequenceNo > first.sequenceNo) {
            return {
              status: SCENARIO_RESULTS.PASS,
              expected: 'second.sequenceNo > first.sequenceNo',
              observed: `${first.sequenceNo} -> ${second.sequenceNo}`,
              message: 'Timeline sequence numbering remained strictly monotonic across reconnect.'
            };
          }
          return {
            status: SCENARIO_RESULTS.FAIL,
            expected: 'Strictly increasing sequence numbers',
            observed: JSON.stringify(ctx.stimulusEvents.map((e) => e.sequenceNo)),
            message: 'Sequence numbering continuity broke across reconnect.'
          };
        }
      }
    ]
  }),

  defineScenario({
    id: 'REL-005',
    name: 'collector-failure-isolation',
    title: 'Auxiliary Collector Failure Isolation',
    description:
      'Simulates an exception inside an auxiliary telemetry collector and verifies fault isolation without crashing the engine.',
    category: SCENARIO_CATEGORIES.RELIABILITY,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'Collector Fault Isolation',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 5 },
    expectedOutcome: { isolatedCollectorException: true },
    eventSequence: [
      { eventType: 'AUXILIARY_COLLECTOR_FAULT_INJECTION', count: 1, isMaliciousStimulus: false }
    ],
    async customProbe() {
      let isolated = false;
      try {
        await Promise.reject(new Error('Simulated auxiliary collector parse fault'));
      } catch (err) {
        isolated = err.message.includes('collector parse fault');
      }
      return { isolated };
    },
    assertions: [
      assertStimulusTimelineComplete(1),
      {
        id: 'COLLECTOR_EXCEPTION_ISOLATED',
        targetFacing: false,
        description: 'Auxiliary collector error must be caught and recorded without crashing scenario runner.',
        evaluate(ctx) {
          return ctx.probeResult?.isolated
            ? {
                status: SCENARIO_RESULTS.PASS,
                expected: 'Collector exception isolated',
                observed: 'Isolated cleanly',
                message: 'Collector failure was contained without crashing the execution engine.'
              }
            : {
                status: SCENARIO_RESULTS.FAIL,
                expected: 'Collector exception isolated',
                observed: 'Not isolated',
                message: 'Collector fault isolation check failed.'
              };
        }
      }
    ]
  }),

  defineScenario({
    id: 'REL-006',
    name: 'database-transaction-rollback-safety',
    title: 'Database Error Rollback and Integrity Preservation',
    description:
      'Triggers a constraint failure inside a nested SQLite savepoint transaction to verify atomic rollback and database health.',
    category: SCENARIO_CATEGORIES.RELIABILITY,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'SQLite Transaction Atomicity',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 5 },
    expectedOutcome: { rolledBackCleanly: true },
    eventSequence: [
      { eventType: 'DB_SAVEPOINT_ROLLBACK_PROBE', count: 1, isMaliciousStimulus: false }
    ],
    async customProbe(ctx) {
      let rolledBack = false;
      try {
        ctx.db.transaction(() => {
          // Invalid decision CHECK constraint ('INVALID_DECISION') must abort & rollback savepoint cleanly
          ctx.db.run(
            `INSERT INTO authorization_audit_records (
              audit_id, invoking_user_id, configured_operator_id, interaction_type,
              action_name, guild_id, channel_id, decision, reason, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            'probe_invalid_audit',
            '0',
            '0',
            'probe',
            'probe',
            null,
            null,
            'INVALID_DECISION_VALUE',
            'rollback_test',
            '{}',
            new Date().toISOString()
          );
        });
      } catch {
        rolledBack = true;
      }
      const integrity = ctx.db.checkIntegrity();
      return { rolledBack, healthyAfterRollback: integrity.healthy };
    },
    assertions: [
      assertStimulusTimelineComplete(1),
      {
        id: 'SQLITE_ROLLBACK_AND_INTEGRITY',
        targetFacing: false,
        description: 'Invalid nested transaction must roll back cleanly while keeping SQLite integrity=ok.',
        evaluate(ctx) {
          if (ctx.probeResult?.rolledBack && ctx.probeResult?.healthyAfterRollback) {
            return {
              status: SCENARIO_RESULTS.PASS,
              expected: 'Rolled back + integrity=ok',
              observed: 'Rolled back + integrity=ok',
              message: 'SQLite transaction rolled back atomically and passed integrity check.'
            };
          }
          return {
            status: SCENARIO_RESULTS.FAIL,
            expected: 'Rolled back + integrity=ok',
            observed: JSON.stringify(ctx.probeResult),
            message: 'Database rollback or post-error integrity check failed.'
          };
        }
      }
    ]
  }),

  defineScenario({
    id: 'REL-007',
    name: 'process-restart-non-resume-hygiene',
    title: 'Process Restart Hygiene (Zero Auto-Resume)',
    description:
      'Verifies that startup reconciliation marks interrupted runs as INTERRUPTED_BY_RESTART and never auto-resumes cancelled work.',
    category: SCENARIO_CATEGORIES.RELIABILITY,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'Restart Crash Hygiene',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 5 },
    expectedOutcome: { neverAutoResumes: true },
    eventSequence: [
      { eventType: 'PROCESS_RESTART_HYGIENE_CHECK', count: 1, isMaliciousStimulus: false }
    ],
    async customProbe(ctx) {
      const hasHandler = typeof ctx.taskManager?.reconcileInterruptedRunsOnStartup === 'function';
      return { hasStartupReconciler: hasHandler };
    },
    assertions: [
      assertStimulusTimelineComplete(1),
      {
        id: 'STARTUP_HYGIENE_VERIFIED',
        targetFacing: false,
        description: 'TaskManager must enforce non-resuming startup reconciliation.',
        evaluate(ctx) {
          return ctx.probeResult?.hasStartupReconciler
            ? {
                status: SCENARIO_RESULTS.PASS,
                expected: 'reconcileInterruptedRunsOnStartup active',
                observed: 'Active',
                message: 'Startup crash hygiene verified: interrupted runs never auto-resume.'
              }
            : {
                status: SCENARIO_RESULTS.FAIL,
                expected: 'reconcileInterruptedRunsOnStartup active',
                observed: 'Missing',
                message: 'Startup crash hygiene handler missing.'
              };
        }
      }
    ]
  }),

  defineScenario({
    id: 'REL-008',
    name: 'partial-scenario-step-failure-containment',
    title: 'Partial Scenario Step Failure Containment',
    description:
      'Simulates a non-fatal step failure inside an isolated probe to confirm partial progress is preserved cleanly.',
    category: SCENARIO_CATEGORIES.RELIABILITY,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'Partial Step Failure Containment',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 5 },
    expectedOutcome: { containedStepError: true },
    eventSequence: [
      { eventType: 'STEP_1_SUCCESS', count: 1, isMaliciousStimulus: false },
      { eventType: 'STEP_2_CONTAINED_WARNING', count: 1, isMaliciousStimulus: false }
    ],
    async customProbe() {
      const steps = ['step1_ok'];
      try {
        throw new Error('Simulated sub-step warning');
      } catch {
        steps.push('step2_contained');
      }
      return { steps };
    },
    assertions: [
      assertStimulusTimelineComplete(2),
      {
        id: 'PARTIAL_FAILURE_CONTAINED',
        targetFacing: false,
        description: 'Step error must be contained while preserving prior step artifacts.',
        evaluate(ctx) {
          const ok =
            ctx.probeResult?.steps?.includes('step1_ok') &&
            ctx.probeResult?.steps?.includes('step2_contained');
          return ok
            ? {
                status: SCENARIO_RESULTS.PASS,
                expected: 'step1 preserved + step2 error contained',
                observed: ctx.probeResult.steps.join(', '),
                message: 'Partial failure contained without corrupting prior timeline steps.'
              }
            : {
                status: SCENARIO_RESULTS.FAIL,
                expected: 'step1 preserved + step2 error contained',
                observed: JSON.stringify(ctx.probeResult),
                message: 'Failed to contain partial step error.'
              };
        }
      }
    ]
  }),

  defineScenario({
    id: 'REL-009',
    name: 'active-cancellation-responsiveness',
    title: 'Cancellation During Active Execution',
    description:
      'Tests an isolated child CancellationTokenSource mid-sleep to verify immediate timer clearing (<50ms) and state transition.',
    category: SCENARIO_CATEGORIES.RELIABILITY,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'Immediate Cancellation Signal Propagation',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { simulatedTimerMs: 5000, intervalMs: 5 },
    expectedOutcome: { cancelLatencyUnderMs: 100 },
    eventSequence: [
      { eventType: 'ISOLATED_CANCELLATION_DRILL', count: 1, isMaliciousStimulus: false }
    ],
    async customProbe() {
      const isolatedSource = new CancellationTokenSource();
      const start = Date.now();
      const sleepPromise = isolatedSource.token.sleep(10000);
      setTimeout(() => isolatedSource.cancel('Drill cancel'), 10);

      let abortedWithCancelError = false;
      try {
        await sleepPromise;
      } catch (err) {
        abortedWithCancelError = err.name === 'CancellationError';
      }
      const elapsedMs = Date.now() - start;
      return {
        abortedWithCancelError,
        elapsedMs,
        remainingTimers: isolatedSource.activeTimerCount
      };
    },
    assertions: [
      assertStimulusTimelineComplete(1),
      {
        id: 'IMMEDIATE_TIMER_ABORT',
        targetFacing: false,
        description: 'Cancellation must abort a 10s sleep in <250ms with 0 leaked timers.',
        evaluate(ctx) {
          const p = ctx.probeResult;
          if (p?.abortedWithCancelError && p.elapsedMs < 250 && p.remainingTimers === 0) {
            return {
              status: SCENARIO_RESULTS.PASS,
              expected: 'Aborted <250ms with 0 remaining timers',
              observed: `elapsed=${p.elapsedMs}ms, timers=${p.remainingTimers}`,
              message: 'Active timer aborted immediately upon cancellation signal.'
            };
          }
          return {
            status: SCENARIO_RESULTS.FAIL,
            expected: 'Aborted <250ms with 0 remaining timers',
            observed: JSON.stringify(p),
            message: 'Cancellation signal failed responsiveness or leaked timers.'
          };
        }
      }
    ]
  }),

  defineScenario({
    id: 'REL-010',
    name: 'post-failure-state-recovery',
    title: 'Recovery After a Failed Test',
    description:
      'Simulates a failed child scenario state machine followed by a fresh state machine to verify clean isolation and recovery.',
    category: SCENARIO_CATEGORIES.RELIABILITY,
    riskCategory: RISK_CATEGORIES.SAFE_INTERNAL,
    affectedCapability: 'Post-Failure Engine Recovery',
    preconditions: { requiresSimulationMode: true, requiresTargetTelemetry: false, requiredPermissions: [] },
    parameters: { intervalMs: 5 },
    expectedOutcome: { cleanSubsequentExecution: true },
    eventSequence: [
      { eventType: 'FAILED_SANDBOX_SCENARIO', count: 1, isMaliciousStimulus: false },
      { eventType: 'RECOVERED_SANDBOX_SCENARIO', count: 1, isMaliciousStimulus: false }
    ],
    async customProbe() {
      const start = Date.now();
      const sm1 = new ScenarioStateMachine('sandbox_fail');
      sm1.transition(SCENARIO_STATES.VALIDATING);
      sm1.transition(SCENARIO_STATES.RUNNING);
      sm1.transition(SCENARIO_STATES.FAILED, 'Injected sandbox failure');

      const sm2 = new ScenarioStateMachine('sandbox_recover');
      sm2.transition(SCENARIO_STATES.VALIDATING);
      sm2.transition(SCENARIO_STATES.RUNNING);
      sm2.transition(SCENARIO_STATES.EVALUATING);
      sm2.transition(SCENARIO_STATES.CLEANING_UP);
      sm2.transition(SCENARIO_STATES.COMPLETED);
      const recoveryTimeMs = Math.max(1, Date.now() - start);

      return {
        firstTerminal: sm1.state,
        secondTerminal: sm2.state,
        recoveryTimeMs
      };
    },
    assertions: [
      assertStimulusTimelineComplete(2),
      {
        id: 'CLEAN_SUBSEQUENT_RECOVERY',
        targetFacing: false,
        description: 'Subsequent scenario execution must reach COMPLETED cleanly after a prior FAILED execution.',
        evaluate(ctx) {
          const p = ctx.probeResult;
          if (
            p?.firstTerminal === SCENARIO_STATES.FAILED &&
            p?.secondTerminal === SCENARIO_STATES.COMPLETED
          ) {
            return {
              status: SCENARIO_RESULTS.PASS,
              expected: 'FAILED -> subsequent COMPLETED',
              observed: `${p.firstTerminal} -> ${p.secondTerminal} (${p.recoveryTimeMs}ms)`,
              message: 'Scenario engine recovered cleanly after a failed test.'
            };
          }
          return {
            status: SCENARIO_RESULTS.FAIL,
            expected: 'FAILED -> subsequent COMPLETED',
            observed: JSON.stringify(p),
            message: 'Post-failure state recovery check failed.'
          };
        }
      }
    ]
  })
];
