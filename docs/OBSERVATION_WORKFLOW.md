# Autonomous `/observe` Workflow

> **Creator:** `MADE BY TANVEER`  
> **Primary Entry Point:** `/observe` (strictly zero arguments)

## 1. Design Philosophy

Normal security evaluation requires typing `/observe` with **zero arguments**. All environment discovery, integration verification, scenario planning, bounded execution, correlation, analysis, and private DM reporting run automatically using validated defaults.

---

## 2. Ten-Stage Execution Lifecycle

```text
[/observe]
   |
   +--> Stage 1:  INITIALIZING_ASSESSMENT           (Create obs_... ID, sync catalog)
   +--> Stage 2:  VERIFYING_AUTH_AND_ENVIRONMENT    (Validate operator & safety config)
   +--> Stage 3:  INSPECTING_DISCORD_METADATA       (Guild ID/name, perms, installed bots)
   +--> Stage 4:  IDENTIFYING_TARGET_INTEGRATIONS   (Verify Astra Astra; refuse guessing)
   +--> Stage 5:  CHECKING_PERMISSIONS_AND_COLLECTORS (SQLite integrity, adapter health)
   +--> Stage 6:  PREPARING_TEST_SCENARIOS          (TestPlanner: SELECT / SKIP / BLOCK)
   +--> Stage 7:  RUNNING_CONTROLLED_SIMULATIONS    (ScenarioEngine: concurrency <= 3)
   +--> Stage 8:  CORRELATING_EVIDENCE              (Stimulus <-> Astra Astra telemetry)
   +--> Stage 9:  CALCULATING_METRICS               (13 metrics + SecurityAnalyzer + Gate)
   +--> Stage 10: PREPARING_PRIVATE_REPORT          (SQLite save + Operator DM + fallback)
```

### Honest Progress Reporting
`ObservationWorkflow` (`src/observe/workflow.js`) updates each stage to `IN_PROGRESS` before work begins and marks `COMPLETED` **only after** the stage's work and SQLite write have finished. If a stage fails, that exact stage is marked `FAILED`, `lastSuccessfulStage` is preserved, and a structured Workflow Failure DM is sent.

---

## 3. Target Bot Anti-Guessing Rules (Stage 4)

`AstraAstraAdapter.identifyTarget()` (`src/integrations/astraAstraAdapter.js`) resolves target identity strictly:
1. **`VERIFIED`:** `ASTRA_ASTRA_BOT_ID` is configured and matches an installed bot in the guild, or validated telemetry carries a single verified bot ID present in the guild.
2. **`TELEMETRY_ONLY`:** Verified bot ID + active imported telemetry exist, though live guild member cache is absent.
3. **`CONFIGURED_NOT_PRESENT`:** `ASTRA_ASTRA_BOT_ID` is set, but that bot is not in the guild and no telemetry is loaded.
4. **`AMBIGUOUS`:** Multiple candidate bots exist in the guild while `ASTRA_ASTRA_BOT_ID` is unset. **The platform refuses to guess which bot is Astra Astra**, records `AMBIGUOUS`, and emits an informational finding requesting clarification.
5. **`UNCONFIGURED`:** Neither `ASTRA_ASTRA_BOT_ID` nor verified telemetry bot ID is configured.

---

## 4. Overall Status Labels

The platform **never** labels a run `"FULLY_OBSERVED"` when target integration or evidence is incomplete:
- `READY_FOR_APPROVAL`: All 8 Part-10 safeguards hold and verified telemetry is active.
- `COMPLETED_VERIFIED_TELEMETRY`: Verified target + active telemetry correlated cleanly.
- `COMPLETED_PARTIAL_VISIBILITY`: Target ID or partial telemetry present, with visibility gaps documented.
- `COMPLETED_SIMULATION_ONLY`: Standalone simulation completed; target assertions marked `INCONCLUSIVE`.
- `CANCELLED`: Halted cleanly via `/stop` or maximum observation duration cap.
- `FAILED`: Aborted due to an unexpected stage error (failure report saved & DMed).
- `INTERRUPTED_BY_RESTART`: Reconciled on startup after an unclean process termination (never auto-resumed).

---

## 5. Ready-to-Test (`READY_FOR_APPROVAL`) Workflow

A completed `/observe` run **never** automatically triggers a follow-up test. `SafetyGate.evaluateEligibility()` checks all 8 safeguards:
1. Verified operator identity (`1131248987173814336`).
2. Guild ID present in `TEST_GUILD_ALLOWLIST` / `DEV_GUILD_ID` when `REQUIRE_TEST_GUILD_ALLOWLIST=true`.
3. Target `Astra Astra` identity `VERIFIED`.
4. Non-empty bounded scenario selection.
5. Valid concurrency (`1..10`) and duration (`1..60m`) limits.
6. Deterministic reversible cleanup plan on all selected scenarios.
7. Operational `/stop` `TaskManager`.
8. Valid startup safety configuration.

Before approving via `/nuke action:approve`, `SafetyGate.revalidateApproval()` re-checks all 8 safeguards and verifies the SHA-256 `scopeFingerprint` so approval applies strictly to the exact described run.
