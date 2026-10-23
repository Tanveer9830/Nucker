# Command Reference

> **Creator:** `MADE BY TANVEER`  
> **Access Control:** 100% of commands are restricted exclusively to numeric Discord User ID `AUTHORIZED_OPERATOR_ID` (`1131248987173814336`). All replies are delivered ephemerally or via private operator DM.

## 1. Command Registration

Register slash commands via Discord's Application Commands REST API:

```bash
# Instant guild-scoped registration to DEV_GUILD_ID (recommended for testing)
npm run commands:register

# Global application-command registration
npm run commands:register -- --global
```

Every command sets `.setDefaultMemberPermissions(0)` at the Discord application level **and** enforces mandatory server-side verification via `AuthorizationGate`.

---

## 2. Autonomous Observation Commands

| Command | Arguments | Description |
| --- | --- | --- |
| `/observe` | **None (0 arguments)** | Primary entry point. Starts a new autonomous 10-stage security observation workflow using validated configuration and defaults, updating ephemeral progress per stage and delivering a private DM report upon completion. |
| `/observe-status` | None | Displays active `TaskManager` runs, scenario concurrency slots, latest run stage progress, and interactive **Refresh Status** / **Emergency Stop** buttons. |
| `/observe-history` | `limit` *(int, optional, 1–25)* | Lists recent observation runs with status, guild ID, and PASS/FAIL/BLOCKED/INCONCLUSIVE counts. |
| `/observe-report` | `observation_id` *(string, optional)* | Regenerates and displays the private security report directly from persisted SQLite records without rerunning scenarios. Defaults to the latest run. |
| `/observe-export` | `format` *(`markdown`\|`json`)*, `observation_id` *(optional)* | Attaches and downloads the persisted report as `.md` or `.json`. |
| `/observe-compare` | `older_id` *(optional)*, `newer_id` *(optional)* | Compares two runs (defaults to the two most recent runs) and lists regressions (`PASS -> FAIL/PARTIAL`), verified improvements (`FAIL/PARTIAL -> PASS`), unchanged, and visibility-changed scenarios. |
| `/report` | `observation_id` *(string, optional)* | Top-level alias for `/observe-report`. |

---

## 3. Simulation Laboratory Commands

| Command | Arguments | Description |
| --- | --- | --- |
| `/lab` | None | Unified laboratory overview showing catalog size, simulation mode status, active jobs, and cleanup summary. |
| `/lab-scenarios` | `category` *(optional enum)* | Lists implemented scenarios across all 5 categories (`EVENT_DETECTION`, `TIMING_CORRELATION`, `RELIABILITY`, `FALSE_POSITIVE_RESISTANCE`, `INCIDENT_RESPONSE`) with version, capability, and timeout. |
| `/lab-status` | None | Displays active simulation worker slots, queued scenario counts, and duration caps. |
| `/lab-report` | `observation_id` *(optional)* | Lists every scenario execution ID, version, final classification, state, and runtime duration for a run. |
| `/lab-replay` | `execution_id` *(optional)* | Replays a prior scenario execution in an isolated lab observation run using its exact persisted parameters and scenario version. |
| `/lab-cleanup` | `observation_id` *(optional)* | Displays post-simulation cleanup verification records and highlights any incomplete cleanup items. |
| `/nuke` | `action` *(`status`\|`approve`)*, `observation_id` *(optional)* | Inspects or revalidates Part-10 `READY_FOR_APPROVAL` single-run controlled simulation eligibility across all 8 safety gates. Never performs destructive live server actions. |

---

## 4. Security Evaluation Commands

| Command | Arguments | Description |
| --- | --- | --- |
| `/security` | None | Unified security posture summary combining latest run status, transparent defense score, and finding counts. |
| `/security-assess` | `observation_id` *(optional)* | Summarizes persisted evidence records broken down strictly by evidence source category. |
| `/security-score` | `observation_id` *(optional)* | Displays transparent security scoring formula, weights, and component scores. Explicitly withholds target score (`UNVERIFIED`) when Astra Astra telemetry is unavailable. |
| `/security-findings` | `observation_id` *(optional)* | Displays structured findings separated into `CONFIRMED_DEFECT`, `SUSPECTED_WEAKNESS`, and `INFORMATIONAL_OBSERVATION`. |
| `/security-regressions` | None | Displays saved regression baselines, regression rate, and regressed scenario IDs. |
| `/security-recommendations` | `observation_id` *(optional)* | Displays actionable, evidence-linked remediation guidance (`What Should Change`, `Why It Matters`, `Supporting Evidence`, `How to Implement`, `How to Verify`, `Regression Risk`, `Tests to Rerun`). |

---

## 5. Control & Maintenance Commands

| Command | Arguments | Description |
| --- | --- | --- |
| `/stop` | None | Emergency cancellation command. Immediately flips cancellation tokens, stops scheduling queued work, clears active timers, executes bounded cleanup, marks unfinished scenarios `CANCELLED`, and reports cleanup status honestly. |
| `/health` | None | Displays SQLite integrity (`PRAGMA integrity_check`), `AstraAstraAdapter` telemetry status, `TaskManager` state, `RateLimitAwareExecutor` counters, Discord Gateway state, RSS memory, and uptime. |
| `/config-validate` | None | Validates current runtime configuration and reports validation status, errors, and warnings with all secrets redacted. |
| `/config` | None | Prints the complete sanitized runtime configuration JSON (`sanitizeConfigForDisplay`). |
| `/about` | None | Displays project attribution (`MADE BY TANVEER`), target system (`Astra Astra`), and exclusive operator model. |
| `/version` | None | Displays application version, Node.js version, `discord.js` version, and scenario catalog count. |
| `/help` | None | Displays the categorized operator-only command reference. |
