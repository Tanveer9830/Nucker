# Testing & Quality Assurance Guide

> **Creator:** `MADE BY TANVEER`

## 1. Running the Automated Test Suite

The test suite uses Node.js 22's native `node:test` runner and `node:assert/strict` with zero external mocking framework dependencies:

```bash
# Run complete unit + integration test suite
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration
```

---

## 2. Acceptance Test Coverage Matrix (Part 18)

| # | Acceptance Requirement | Test File |
| --- | --- | --- |
| 1 | Every command's authorization (all 27 commands) | `tests/unit/authAndCommands.test.js` |
| 2 | Unauthorized access denial (commands, buttons, selects, modals, username spoofing) | `tests/unit/authAndCommands.test.js` |
| 3 | `/observe` with zero arguments | `tests/unit/authAndCommands.test.js`, `tests/integration/observeWorkflow.test.js` |
| 4 | Automatic observation initialization & 10-stage order | `tests/integration/observeWorkflow.test.js` |
| 5 | Target identification & ambiguous multi-bot anti-guessing | `tests/integration/observeWorkflow.test.js` |
| 6 | Scenario selection, duplicate skipping, time budget & rationale | `tests/unit/metricsAndPlanner.test.js` |
| 7 | Evidence collection & strict 5-source classification | `tests/integration/observeWorkflow.test.js` |
| 8 | Report generation & DM failure (`50007`) fallback handling | `tests/integration/observeWorkflow.test.js` |
| 9 | Failed stage Workflow Failure DM & `PARTIAL` observations | `tests/integration/observeWorkflow.test.js` |
| 10 | All 13 metric calculations, median/p95 sample gates & score withholding | `tests/unit/metricsAndPlanner.test.js` |
| 11 | Integration failures (missing log files, tampered HMAC webhook signatures) | `tests/integration/observeWorkflow.test.js` |
| 12 | `/stop` responsiveness under active multi-scenario load | `tests/integration/stopAndResilience.test.js` |
| 13 | Concurrent `/stop` coalescing & unauthorized `/stop` isolation | `tests/integration/stopAndResilience.test.js` |
| 14 | Database migrations, backup, restore recovery & corrupt-backup rejection | `tests/unit/databaseAndMigration.test.js` |
| 15 | Discord `429` `retry_after` compliance, `5xx` retries & timeouts | `tests/unit/metricsAndPlanner.test.js` |
| 16 | Regression baseline comparisons & `/observe-compare` | `tests/integration/stopAndResilience.test.js` |
| 17 | Recursive secret redaction across strings, logs, Errors & objects | `tests/unit/configAndRedaction.test.js` |
| 18 | Cleanup verification & honest incomplete-cleanup reporting | `tests/integration/stopAndResilience.test.js` |
| 19 | Process restart hygiene (`INTERRUPTED_BY_RESTART`, zero auto-resume) | `tests/integration/stopAndResilience.test.js` |
| 20 | Missing Discord permissions (`BLOCKED`) & unavailable telemetry (`INCONCLUSIVE`) | `tests/integration/observeWorkflow.test.js` |

---

## 3. Test Fixtures (`tests/fixtures/`)

- `astra-structured-logs.json` — Validated Astra Astra JSON alert & mitigation events
- `astra-incident-reports.json` — Imported Astra Astra incident report fixture
- `astra-detection-history.ndjson` — Newline-delimited detection history export fixture
