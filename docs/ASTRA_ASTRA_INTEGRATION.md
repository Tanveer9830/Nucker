# Astra Astra Integration Guide

> **Creator:** `MADE BY TANVEER`  
> **Target System Under Test:** `Astra Astra` (`AstraMaster`)

## 1. Standalone Safety Boundary

**Tanveer Ka Beta Newker** treats **Astra Astra** as an external system under test. It **never** modifies Astra Astra's codebase, database, secrets, or internal memory. When no telemetry source is configured, the platform operates cleanly in standalone simulation mode and marks target-facing assertions `INCONCLUSIVE` rather than inventing results.

---

## 2. Adapter Interface (`src/integrations/adapterInterface.js`)

All target integrations implement `TargetIntegrationAdapter`:
- `getHealth()` — reports configured sources, event counts, and validation errors.
- `identifyTarget(guildMetadata)` — establishes verified target identity without guessing among multiple bots.
- `collectTelemetry()` — loads, validates, sanitizes, and chronologically orders external telemetry records.
- `getCapabilityVisibility(capabilityKey)` — reports whether a specific internal field is exposed.

Additional security bots or data transports can subclass `TargetIntegrationAdapter` without altering `ObservationWorkflow` or `ScenarioEngine`.

---

## 3. Supported Data Sources in `AstraAstraAdapter`

Configure any combination in `.env`:

| Data Source | Environment Keys | Supported Formats |
| --- | --- | --- |
| Verified Bot Identity & Version | `ASTRA_ASTRA_BOT_ID`, `ASTRA_ASTRA_NAME`, `ASTRA_ASTRA_VERSION` | 17–20 digit Discord Snowflake + semantic version string |
| Structured JSON Logs | `ASTRA_ASTRA_LOG_PATH` | JSON array (`[...]`), `{ "events": [...] }`, or NDJSON |
| Imported Incident Reports | `ASTRA_ASTRA_INCIDENT_PATH` | JSON array or `{ "incidents": [...] }` |
| Exported Detection Histories | `ASTRA_ASTRA_DETECTION_HISTORY_PATH` | JSON array, `{ "detections": [...] }`, or NDJSON |
| Authenticated Telemetry Webhooks | `ENABLE_TELEMETRY_WEBHOOK=true`, `TELEMETRY_WEBHOOK_HOST`, `TELEMETRY_WEBHOOK_PORT`, `TELEMETRY_WEBHOOK_SECRET` | `POST /telemetry/astra-astra` signed with HMAC-SHA256 |
| Documented Test Interfaces | Programmatic `astraAdapter.ingestTestInterfaceResponse(payload)` | Validated JSON probe object |

---

## 4. Telemetry Event Schema

Every imported or webhook event is validated as untrusted input (`validateAndNormalizeTelemetryRecord`):

```json
{
  "id": "astra_evt_001",
  "botId": "998877665544332211",
  "version": "2.4.1",
  "kind": "ANTI_NUKE_ALERT",
  "alertType": "CHANNEL_NUKE_DETECTED",
  "scenarioId": "ED-001",
  "correlationKey": "corr_ED-001_exec_...",
  "triggerEventType": "CHANNEL_DELETE",
  "action": "QUARANTINE_EXECUTOR",
  "timestamp": "2026-10-24T00:00:01.120Z",
  "responseLatencyMs": 180,
  "actionSucceeded": true,
  "evidenceRetained": true,
  "recovered": true,
  "summary": "Detected rapid channel create/delete sequence"
}
```

### Unexposed Internal Fields
If Astra Astra omits optional internal fields (`responseLatencyMs`, `actionSucceeded`, `evidenceRetained`, `recovered`), `AstraAstraAdapter` sets them to `null` (`unavailable`). Assertions checking those fields evaluate to `INCONCLUSIVE`, never a fabricated `PASS` or `FAIL`.

---

## 5. Authenticated Webhook Signing Example

To push live telemetry from **Astra Astra** to `http://127.0.0.1:8787/telemetry/astra-astra`:

```javascript
import crypto from 'node:crypto';

const secret = process.env.TELEMETRY_WEBHOOK_SECRET; // >= 16 chars
const timestamp = String(Date.now());
const rawBody = JSON.stringify(telemetryEvent);
const signature = crypto
  .createHmac('sha256', secret)
  .update(`${timestamp}.${rawBody}`, 'utf8')
  .digest('hex');

await fetch('http://127.0.0.1:8787/telemetry/astra-astra', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Astra-Timestamp': timestamp,
    'X-Astra-Signature': `sha256=${signature}`
  },
  body: rawBody
});
```
