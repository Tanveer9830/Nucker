# Operational Troubleshooting Guide

> **Creator:** `MADE BY TANVEER`

## 1. Startup Fails with `ConfigValidationError`

**Symptom:** Process exits at startup reporting `AUTHORIZED_OPERATOR_ID is missing` or `invalid`.
**Cause:** `AUTHORIZED_OPERATOR_ID` in `.env` is unset or set to a username/tag instead of a 17–20 digit numeric Discord Snowflake.
**Resolution:**
1. Set `AUTHORIZED_OPERATOR_ID=1131248987173814336` in `.env`.
2. Run `npm run config:validate`.

---

## 2. Commands Respond with `"Access denied"`

**Symptom:** Slash command or button returns ephemeral `Access denied. Tanveer Ka Beta Newker is restricted exclusively to the authorized operator.`
**Cause:** The invoking Discord account's numeric user ID does not match `AUTHORIZED_OPERATOR_ID`.
**Resolution:**
- Invoke commands exclusively from operator account `1131248987173814336`.
- Inspect `authorization_audit_records` in SQLite to review the denied `invoking_user_id` and `reason`.

---

## 3. Target Bot Reported as `AMBIGUOUS` or Scenarios Marked `INCONCLUSIVE`

**Symptom:** `/observe` finishes with `AMBIGUOUS_TARGET_BOT_ID_UNSET` or target-facing scenarios show `INCONCLUSIVE`.
**Cause:**
- Multiple bots exist in the server and `ASTRA_ASTRA_BOT_ID` is empty (anti-guessing rule prevented inventing an identity).
- Or no external **Astra Astra** telemetry source (`ASTRA_ASTRA_LOG_PATH`, `ASTRA_ASTRA_INCIDENT_PATH`, `ASTRA_ASTRA_DETECTION_HISTORY_PATH`, or `ENABLE_TELEMETRY_WEBHOOK=true`) is connected.
**Resolution:**
1. Set `ASTRA_ASTRA_BOT_ID=<Astra Astra's numeric bot ID>` in `.env`.
2. Configure at least one telemetry input (see [`docs/ASTRA_ASTRA_INTEGRATION.md`](ASTRA_ASTRA_INTEGRATION.md)).
3. Run `/health` to confirm `telemetryAvailable=true`, then rerun `/observe`.

---

## 4. Operator DM Report Not Received (`50007 Cannot send messages to this user`)

**Symptom:** Ephemeral notice states `Private DM Delivery Fallback`.
**Cause:** Discord User Privacy Settings block DMs from shared server bots, or the bot ran in offline test mode.
**Resolution:**
- Enable **Allow direct messages from server members** for your test lab server in Discord Privacy Settings.
- Retrieve the preserved report immediately via `/observe-report` or `/observe-export` (nothing was lost; full report is stored in SQLite and `./data/exports/`).

---

## 5. Run Marked `INTERRUPTED_BY_RESTART`

**Symptom:** `/observe-history` shows a prior run in `INTERRUPTED_BY_RESTART` status.
**Cause:** The Node.js process or host restarted while `/observe` was running. By design (Part 12), interrupted or cancelled simulations are **never** automatically resumed.
**Resolution:**
1. Run `/health` and `/lab-cleanup` to confirm post-restart cleanup verification.
2. Start a fresh run anytime with `/observe`.

---

## 6. SQLite Database Integrity Warning

**Symptom:** `npm run db:integrity` reports non-`ok` status or foreign key violations.
**Resolution:**
1. Stop the application process.
2. Restore the latest verified snapshot from `./data/backups/`:
   ```bash
   ./scripts/restore.sh ./data/backups/<latest-backup>.sqlite
   npm run db:integrity
   ```
