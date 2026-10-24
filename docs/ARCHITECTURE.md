# Architecture Reference

> **Creator:** `MADE BY TANVEER`  
> **Application:** `Tanveer Ka Beta Newker`

## 1. Architectural Principles

1. **Strict Separation of Concerns:** Discord interaction handlers (`src/commands/`, `src/interactions/`) contain zero database SQL or simulation logic; they delegate via dependency injection to domain services (`ObservationWorkflow`, `ScenarioEngine`, `TaskManager`, `SecurityAnalyzer`, `ReportGenerator`).
2. **Deny-by-Default Authorization:** Every inbound Discord command, button, select menu, and modal passes through `AuthorizationGate` before reaching any service.
3. **Evidence Purity:** Simulated stimuli, live Discord observations, imported Astra Astra telemetry, engine assertions, and analyst inferences are stored with distinct immutable `source_type` tags and SHA-256 content hashes.
4. **Bounded Execution & Instant Cancellation:** All scenario loops, timers, and retry waits bind to hierarchical `CancellationTokenSource` instances managed by `TaskManager`.

---

## 2. High-Level System Diagram

```text
+-------------------------------------------------------------------------+
|                        Discord Gateway & REST API                       |
+--------------------+----------------------------------+-----------------+
                     | InteractionCreate                | Private DM / Ephemeral
                     v                                  |
+---------------------------------------+               |
|       src/interactions/router.js      |               |
|  +---------------------------------+  |               |
|  |   src/auth/authorizationGate.js |  |---> authorization_audit_records
|  | (Exact ID == 1131248987173814336)|  |
|  +-----------------+---------------+  |
+--------------------|------------------+
                     v
+-------------------------------------------------------------------------+
|                       src/observe/workflow.js                           |
|   Stages 1..5: EnvironmentDiscovery + AstraAstraAdapter + SafetyGate    |
|   Stage 6:     TestPlanner (Select / Skip / Block with rationale)       |
|   Stage 7:     ScenarioEngine <--- TaskManager (/stop + Concurrency=3)  |
|   Stage 8:     EvidenceStore (Correlation & Deduplication)              |
|   Stage 9:     MetricsCalculator + SecurityAnalyzer + Baselines         |
|   Stage 10:    ReportGenerator + OperatorNotifier ----------------------+
+------------------------------------+------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|             src/database/ (Native Node 22 SQLite + WAL Mode)            |
|  observation_runs | scenario_executions | normalized_events             |
|  evidence_records | findings | reports | regression_baselines           |
|  cleanup_records  | scenario_definitions | configuration_metadata       |
+-------------------------------------------------------------------------+
```

---

## 3. Directory Layout

| Directory | Responsibility |
| --- | --- |
| `src/index.js` | Dependency injection bootstrapper, startup validation, Discord client wiring, graceful shutdown |
| `src/config/` | Environment parsing, Snowflake & bounds validation, sanitized display projection, CLI validator |
| `src/auth/` | Centralized deny-by-default `AuthorizationGate` middleware & brand verification |
| `src/commands/` | All 27 operator-only slash command definitions & REST registration script |
| `src/interactions/` | Central `InteractionRouter` (commands, buttons, selects, modals) & ephemeral responder |
| `src/observe/` | `EnvironmentDiscovery` & 10-stage zero-argument `ObservationWorkflow` |
| `src/orchestrator/` | `CancellationTokenSource`, `ScenarioStateMachine`, and `TaskManager` (`/stop` + restart hygiene) |
| `src/scenarios/` | Schema validator, 38-scenario catalog (`catalog/`), `TestPlanner`, and `ScenarioEngine` |
| `src/integrations/` | Documented `TargetIntegrationAdapter` interface & `AstraAstraAdapter` (logs, incidents, webhooks) |
| `src/evidence/` | `EvidenceStore` enforcing 5-category source taxonomy, deduplication, and stimulus-response correlation |
| `src/analysis/` | `SecurityAnalyzer` generating defects, weaknesses, informational findings, recommendations, and run diffs |
| `src/metrics/` | `calculateObservationMetrics` (13 metrics + median/p95 latencies) & `calculateTransparentSecurityScore` |
| `src/reports/` | Deterministic SQLite `ReportGenerator` & private DM `OperatorNotifier` with fallback archival |
| `src/database/` | `DatabaseManager` (migrations, transactions, integrity checks, backup/restore, retention) & `PlatformRepositories` |
| `src/logging/` | Structured JSON `Logger` with automatic recursive secret redaction and diagnostic ring buffer |
| `src/safety/` | `SafetyGate` enforcing allowlists and Part-10 8-safeguard `READY_FOR_APPROVAL` revalidation |
| `src/utils/` | Constants, Snowflake/hash helpers, `redactSecrets`, untrusted JSON sanitizer, `RateLimitAwareExecutor` |
