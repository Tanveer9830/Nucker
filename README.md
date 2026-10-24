# TANVEER KA BETA NEWKER

**ULTIMATE AUTONOMOUS SECURITY RESEARCH, ANTI-NUKE EVALUATION & SIMULATION PLATFORM**

- **Creator:** `MADE BY TANVEER`
- **Target System Under Test:** `Astra Astra` (`AstraMaster`)
- **Exclusive Authorized Operator ID:** `1131248987173814336`
- **Runtime Stack:** JavaScript (ES Modules), Node.js LTS (`>= 22.5.0`), `discord.js` v14, Native `node:sqlite` (WAL + Transactions)
- **Primary Entry Point:** `/observe` (zero arguments)
- **Emergency Control:** `/stop` (immediate cancellation)

---

## Overview

**Tanveer Ka Beta Newker** is a standalone, evidence-driven Discord security evaluation and non-destructive simulation platform engineered to evaluate how **Astra Astra** behaves under realistic anti-nuke, timing-burst, reliability, false-positive, and incident-response conditions.

Normal operation requires typing a single zero-argument command:

```text
/observe
```

The platform automatically discovers authorized environment metadata, validates **Astra Astra** telemetry integrations without guessing ambiguous bot identities, plans and executes bounded non-destructive simulations across 38 versioned scenarios, correlates responses with strict evidence-source separation, calculates transparent metrics, persists everything in SQLite, and sends a private report via Discord DM exclusively to operator `1131248987173814336`.

---

## Core Capabilities

- **Absolute Operator-Only Access:** Centralized server-side deny-by-default `AuthorizationGate` enforces exact numeric Discord Snowflake matching (`1131248987173814336`) across all 27 slash commands, buttons, select menus, modals, and control workflows. Every allowed and denied attempt is recorded in `authorization_audit_records`.
- **Zero-Argument `/observe` Workflow:** 10-stage autonomous orchestration with honest real-time ephemeral stage progress updates.
- **38 Versioned Defensive Scenarios:** Covers Event Detection (`ED-001`–`ED-007`), Timing & Correlation (`TC-001`–`TC-009`), Reliability (`REL-001`–`REL-010`), False-Positive Resistance (`FPR-001`–`FPR-006`), and Incident Response (`IR-001`–`IR-006`).
- **Strict Evidence Model:** Never mixes or fabricates evidence. Every observation is labeled as `Live Discord observation`, `Imported Astra Astra telemetry`, `Simulated event`, `Test-engine assertion`, or `Analyst inference`. Missing telemetry is classified `INCONCLUSIVE` or `BLOCKED`—never fabricated into a pass or failure.
- **Immediate `/stop` Cancellation:** Synchronous signal propagation clears pending timers immediately, halts queued scenario scheduling, runs bounded cleanup, marks unfinished scenarios `CANCELLED`, and never auto-resumes interrupted runs across restarts.
- **Deterministic SQLite Persistence & Regeneration:** Full relational schema with migrations, indexes, `PRAGMA integrity_check`, atomic `VACUUM INTO` backups, verified restores, retention pruning, and deterministic report regeneration without rerunning scenarios.

---

## Quick Start

### 1. Run Safe Installer (Ubuntu / Debian / Linux)

```bash
./scripts/install.sh
```

### 2. Configure `.env`

Edit `.env` (created with `0600` permissions from `.env.example`):

```env
AUTHORIZED_OPERATOR_ID=1131248987173814336
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_client_id
DEV_GUILD_ID=your_authorized_test_guild_id
DATABASE_PATH=./data/tanveer-beta-newker.sqlite
LOG_LEVEL=info
SIMULATION_MODE=true
REQUIRE_TEST_GUILD_ALLOWLIST=true
MAX_CONCURRENT_SCENARIOS=3
MAX_OBSERVATION_DURATION_MINUTES=15
```

### 3. Validate Configuration & Register Slash Commands

```bash
npm run config:validate -- --require-discord
npm run commands:register
```

### 4. Start the Platform

```bash
npm start
```

Then run `/observe` inside your Discord server.

---

## Least-Privilege Bot Invite Permissions

Do **not** grant `Administrator` by default. Invite the bot with `applications.commands` + `bot` scopes and only these narrow observation permissions (integer bitfield `117824` + `ViewAuditLog` `128` = `117952`, or individual checkboxes):

- `View Channels` (`ViewChannel`)
- `View Audit Log` (`ViewAuditLog`)
- `Read Message History` (`ReadMessageHistory`)
- `Send Messages` (`SendMessages`)
- `Embed Links` (`EmbedLinks`)
- `Attach Files` (`AttachFiles`)

---

## Documentation Index

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — System design, module boundaries, and dataflow diagrams
- [`docs/COMMANDS.md`](docs/COMMANDS.md) — Complete reference for all 27 operator-only slash commands
- [`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md) — Deny-by-default numeric operator ID model & audit logging
- [`docs/SECURITY.md`](docs/SECURITY.md) — Secret redaction, input validation, rate-limit compliance, webhook HMAC
- [`docs/OBSERVATION_WORKFLOW.md`](docs/OBSERVATION_WORKFLOW.md) — 10-stage `/observe` lifecycle and `READY_FOR_APPROVAL` gate
- [`docs/SCENARIO_ENGINE.md`](docs/SCENARIO_ENGINE.md) — State machine, bounded concurrency, cancellation, and `/stop`
- [`docs/SCENARIOS.md`](docs/SCENARIOS.md) — Complete catalog of all 38 defensive scenarios
- [`docs/ASTRA_ASTRA_INTEGRATION.md`](docs/ASTRA_ASTRA_INTEGRATION.md) — Adapter interface, JSON logs, incidents, NDJSON, HMAC webhooks
- [`docs/EVIDENCE_MODEL.md`](docs/EVIDENCE_MODEL.md) — Source taxonomy, SHA-256 integrity, correlation rules
- [`docs/METRICS.md`](docs/METRICS.md) — Exact formulas, denominators, sample thresholds, and scoring
- [`docs/REPORTS.md`](docs/REPORTS.md) — Private DM structure, failure notices, fallbacks, and sample reports
- [`docs/DATABASE.md`](docs/DATABASE.md) — SQLite schema, migrations, backups, restore, and retention
- [`docs/TESTING.md`](docs/TESTING.md) — Automated unit & integration test suite guide
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Ubuntu/Debian installer, `systemd`, upgrades, rollback, uninstall
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — Operational diagnostics and recovery playbooks
- [`CHANGELOG.md`](CHANGELOG.md) — Version history

---

`MADE BY TANVEER`
