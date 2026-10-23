# Authorization Model

> **Creator:** `MADE BY TANVEER`  
> **Exclusive Authorized Identity:** `1131248987173814336`

## 1. Identity Invariant

**Tanveer Ka Beta Newker** enforces a single immutable rule:

> **Only the exact numeric Discord User Snowflake ID configured in `AUTHORIZED_OPERATOR_ID` (`1131248987173814336`) is authorized to invoke any command, component, modal, or control operation.**

The authorization engine (`src/auth/authorizationGate.js`) **never** trusts or inspects:
- Discord usernames, global display names, or server nicknames (e.g., an attacker naming themselves `MADE BY TANVEER` is unconditionally rejected).
- Guild ownership (`guild.ownerId`).
- Discord `Administrator` or role assignments.
- Visible Discord command permission overrides alone.

---

## 2. Startup Validation Gate

During startup (`src/config/index.js`):
1. `AUTHORIZED_OPERATOR_ID` is validated against `^\d{17,20}$`.
2. If `AUTHORIZED_OPERATOR_ID` is empty, missing, or non-numeric, `privilegedEnabled` is set to `false` and strict startup throws `ConfigValidationError`, refusing to boot privileged operations.

---

## 3. Centralized Server-Side Middleware (`AuthorizationGate`)

```text
Incoming Discord Interaction (Command / Button / Select / Modal)
       |
       v
[AuthorizationGate.evaluate()]
  1. Check config.privilegedEnabled === true && valid Snowflake
  2. Read interaction.user.id (numeric Snowflake check)
  3. Exact match: interaction.user.id === config.authorizedOperatorId
  4. Write immutable row to SQLite `authorization_audit_records` (secrets redacted)
       |
       +---> [DENIED]  ---> Send generic ephemeral denial; NEVER invoke handler
       |
       +---> [ALLOWED] ---> Pass interaction + authAuditId to wrapped handler
```

### Compile/Boot Brand Verification
Every command registered in `buildAuthorizedCommandRegistry()` (`src/commands/index.js`) is wrapped via `authGate.wrapCommand()` and stamped with `Symbol.for('tanveer.beta.newker.operatorAuthWrapped')`. `InteractionRouter` verifies `AuthorizationGate.isWrapped(command)` before execution and applies `authGate.evaluate()` even on unknown command names or expired component IDs.

---

## 4. Audit Logging (`authorization_audit_records`)

Every authorization check records:
- `audit_id` (`aud_...`)
- `invoking_user_id`
- `configured_operator_id`
- `interaction_type` (`chat_input_command`, `button`, `component_or_modal`, etc.)
- `action_name` (e.g., `/observe`, `/stop`, `btn_emergency_stop`)
- `guild_id` and `channel_id`
- `decision` (`ALLOWED` or `DENIED`)
- `reason` (`EXACT_OPERATOR_ID_MATCH`, `USER_ID_MISMATCH`, `MISSING_OR_MALFORMED_INVOKING_USER_ID`, `PRIVILEGED_MODE_DISABLED_INVALID_OPERATOR_CONFIG`)
- `metadata_json` (scrubbed through `redactSecrets()`)
- `created_at` (ISO-8601 UTC)
