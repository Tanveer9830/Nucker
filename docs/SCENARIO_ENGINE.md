# Scenario Execution Engine & `/stop` Task Manager

> **Creator:** `MADE BY TANVEER`

## 1. Scenario State Machine (`src/orchestrator/stateMachine.js`)

Every scenario execution assigned an `exec_...` ID follows explicit legal state transitions enforced by `ScenarioStateMachine`:

```text
PENDING ---> QUEUED ---> VALIDATING ---> RUNNING ---> CORRELATING ---> EVALUATING ---> CLEANING_UP ---> COMPLETED
   |            |             |             |              |               |                |
   +------------+-------------+             +--------------+---------------+----------------+---> CANCELLED / FAILED
                |
                +---> BLOCKED
```

Invalid transitions throw `InvalidStateTransitionError`. Full timestamped transition histories are persisted in `scenario_executions.state_history_json`.

---

## 2. Deterministic Test Planning (`src/scenarios/planner.js`)

`TestPlanner.createPlan()` inspects:
- Database & collector health (blocks scenarios if unhealthy).
- `SIMULATION_MODE` guardrails.
- Required live Discord permissions vs `missingPermissions` (blocks Audit-Log scenarios when `ViewAuditLog` is missing and external Astra Astra telemetry is absent).
- Historical failures (`+50` priority), open findings (`+40`), active regression baseline membership (`+30`), and active telemetry/internal self-test signal (`+25`).
- Remaining wall-clock observation budget across `MAX_CONCURRENT_SCENARIOS` worker lanes (skips excess scenarios with explicit rationale).

Every scenario receives a recorded `SELECTED`, `SKIPPED`, or `BLOCKED` decision in `observation_runs.plan_json`.

---

## 3. Bounded Execution & Outcome Classification (`src/scenarios/engine.js`)

`ScenarioEngine.executeSuite()` runs selected scenarios through `TaskManager.executeBoundedQueue()` (`MAX_CONCURRENT_SCENARIOS=3` default) with per-scenario timeouts (`timeoutMs`, default `10,000 ms`) and global deadline enforcement (`MAX_OBSERVATION_DURATION_MINUTES=15`).

Assertion outcomes aggregate into consistent Part-7 classifications:
- **`PASS`:** 100% of defined assertions satisfied by observed evidence.
- **`FAIL`:** One or more assertions contradicted by observed evidence (e.g., active telemetry missed a simulated attack or triggered a false-positive alert on benign activity).
- **`PARTIAL`:** Primary target detection succeeded (`PASS`), while secondary telemetry fields (e.g., `responseLatencyMs`, `evidenceRetained`, `recovered`) were unexposed (`INCONCLUSIVE`).
- **`BLOCKED`:** Required permissions, integrations, or safety prerequisites were missing prior to execution.
- **`INCONCLUSIVE`:** Simulated stimuli executed cleanly, but external Astra Astra telemetry was unavailable to establish target detection or non-detection. **Missing telemetry is never classified as `FAIL`.**
- **`CANCELLED`:** Aborted cleanly via `/stop` or observation deadline.

---

## 4. Emergency `/stop` Protocol (`src/orchestrator/taskManager.js`)

When operator `1131248987173814336` invokes `/stop`:
1. Cancellation signal flips synchronously across root and child `CancellationTokenSource` instances.
2. Worker scheduling halts (`schedulingHalted = true`).
3. Queued unstarted tasks are immediately marked `CANCELLED` without starting.
4. Pending `sleep()` and deadline `setTimeout` handles are cleared immediately (`clearTimeout`), rejecting active waits with `CancellationError`.
5. In-flight scenarios and registered cleanup hooks are awaited up to `cleanupTimeoutMs` (`3,000 ms`).
6. Partial timelines and results are committed to SQLite.
7. Any remaining non-terminal scenarios are marked `CANCELLED`.
8. Run handles, child tokens, and locks are disposed.
9. Cleanup results (including any hook that timed out) are persisted in `cleanup_records` and reported transparently.

Simultaneous `/stop` calls coalesce onto the active stop promise safely. Unauthorized `/stop` calls are blocked at `AuthorizationGate` before reaching `TaskManager`.

---

## 5. Process Restart Crash Hygiene

On startup, `TaskManager.reconcileInterruptedRunsOnStartup()` scans SQLite for any observation runs left in `INITIALIZING` or `RUNNING` state from a prior process crash or restart, transitions their unfinished scenarios to `CANCELLED`, marks the run `INTERRUPTED_BY_RESTART`, writes a post-restart cleanup record, and **never** automatically resumes interrupted or cancelled simulations.
