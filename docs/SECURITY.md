# Security & Resilience Architecture

> **Creator:** `MADE BY TANVEER`

## 1. Non-Destructive Simulation Boundary

- By default, `SIMULATION_MODE=true`.
- All 38 scenarios in `src/scenarios/catalog/` simulate destructive raid/anti-nuke event patterns **inside the internal test engine** (`ScenarioEngine`) using synthetic stimulus timelines (`EVIDENCE_SOURCES.SIMULATED_EVENT`).
- The platform **never** performs automatic real-server channel deletion, role deletion, mass banning, webhook spam, stealth, evasion, or anti-nuke bypass attacks.
- Any transition to `READY_FOR_APPROVAL` requires passing all 8 safeguards in `SafetyGate` (`src/safety/safetyGate.js`) and never triggers a follow-up test automatically.

---

## 2. Least-Privilege Discord Permissions

Do not grant `Administrator` to **Tanveer Ka Beta Newker**. Recommended guild permissions (`RECOMMENDED_OBSERVATION_PERMISSIONS`):

| Permission | Purpose |
| --- | --- |
| `ViewChannel` | Inspect accessible guild channel structure metadata |
| `ViewAuditLog` | Read audit log availability & permissions health |
| `ReadMessageHistory` | Inspect public/log channel metadata where authorized |
| `SendMessages` | Deliver fallback notifications when authorized |
| `EmbedLinks` | Render structured operator status components |
| `AttachFiles` | Export Markdown/JSON reports ephemerally (`/observe-export`) |

It never attempts to read **Astra Astra**'s private source code, `.env` secrets, process memory, or internal privileged commands.

---

## 3. Secret Redaction (`src/utils/redaction.js`)

`redactSecrets()` and `redactString()` automatically scrub:
- Discord bot tokens (`[MN][A-Za-z\d_-]{22,}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{25,}`) and MFA tokens (`mfa\....`)
- Discord webhook URLs (`https://discord.com/api/webhooks/...`)
- `Bearer` / `Bot` authorization headers
- Environment variable assignments (`DISCORD_TOKEN=...`, `TELEMETRY_WEBHOOK_SECRET=...`)
- Object properties matching sensitive key patterns (`token`, `secret`, `password`, `authorization`, `api_key`, `signature`)
- Explicitly registered runtime secret values (`config.discordToken`, `config.telemetryWebhook.secret`)

Redaction runs automatically before structured logging (`Logger`), authorization audit persistence, evidence storage, and report generation.

---

## 4. Untrusted Input Validation (`src/utils/validation.js`)

All imported JSON logs, incident reports, NDJSON detection histories, and telemetry webhooks are treated as untrusted input:
- Enforces payload byte limits (`2 MiB` files, `256 KiB` HTTP webhooks).
- Enforces maximum object nesting depth (`12` levels).
- Rejects prototype-pollution keys (`__proto__`, `constructor`, `prototype`) inside the `JSON.parse` reviver.
- Strips C0 control characters (`\x00`–`\x1F` except `\t`, `\n`, `\r`) and truncates strings to bounded lengths.
- Validates Snowflake IDs and epoch/ISO-8601 timestamps within sane bounds.

---

## 5. Authenticated Telemetry Webhooks

When `ENABLE_TELEMETRY_WEBHOOK=true`:
- Requires `TELEMETRY_WEBHOOK_SECRET` of at least 16 characters.
- Binds by default to loopback (`127.0.0.1:8787`).
- Verifies `X-Astra-Timestamp` within a 5-minute replay window (`300,000 ms`).
- Verifies `X-Astra-Signature` (`HMAC-SHA256(secret, "${timestamp}.${rawBody}")`) using constant-time `crypto.timingSafeEqual`.
- Deduplicates repeated webhook event IDs (`seenWebhookIds`).

---

## 6. Discord Rate-Limit Compliance (`src/utils/rateLimiter.js`)

`RateLimitAwareExecutor` never bypasses Discord rate limits:
- Inspects `429` responses (`retryAfter`, `rawError.retry_after`, `Retry-After` header) and waits at least the requested duration before retrying.
- Caps retries (`maxRetries = 3`) and maximum backoff (`15,000 ms`).
- Enforces per-request timeouts (`10,000 ms` default) and aborts waits immediately on `/stop` cancellation.

---

## 7. Filesystem & Database Hardening

- `.env` is excluded by `.gitignore` and restricted to `0600` by `scripts/install.sh`.
- `./data`, `./data/backups`, and `./data/exports` are created with `0700` permissions; SQLite files and exported reports are written with `0600` permissions.
- `deploy/tanveer-beta-newker.service` applies `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, and `ProtectHome=read-only`.
