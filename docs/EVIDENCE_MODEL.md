# Evidence Model & Source Classification

> **Creator:** `MADE BY TANVEER`

## 1. Mandatory Five-Category Evidence Taxonomy

Every normalized event (`normalized_events`) and evidence record (`evidence_records`) persisted by `EvidenceStore` (`src/evidence/evidenceStore.js`) **must** carry one of the five canonical `EVIDENCE_SOURCES` values:

| Enum Key | Persisted `source_type` Label | Meaning |
| --- | --- | --- |
| `LIVE_DISCORD_OBSERVATION` | `Live Discord observation` | Authorized Discord guild/channel/permission/bot metadata or live events observed directly from Discord |
| `IMPORTED_ASTRA_TELEMETRY` | `Imported Astra Astra telemetry` | Validated Astra Astra JSON logs, incident exports, NDJSON detection histories, test-interface responses, or HMAC-signed webhooks |
| `SIMULATED_EVENT` | `Simulated event` | Synthetic non-destructive stimulus events emitted inside `ScenarioEngine` |
| `TEST_ENGINE_ASSERTION` | `Test-engine assertion` | Deterministic programmatic assertion & reliability probe evaluations |
| `ANALYST_INFERENCE` | `Analyst inference` | Explicit environment/ambiguity/limitation conclusions derived from discovery state |

Attempting to persist an unlabeled or unknown `sourceType` throws `InvalidEvidenceSourceError`. Categories are **never** merged or stripped in SQLite or reports.

---

## 2. Integrity Hashing & Immutability

Every row written to `evidence_records` computes a canonical sorted-key SHA-256 hex digest (`sha256_hash` via `sha256Hex()` in `src/utils/ids.js`) over `{ sourceType, correlationKey, summary, relationshipExplanation, metadata }`.

---

## 3. Stimulus-to-Response Correlation (`correlateExecution`)

For every scenario execution (`exec_...`), `EvidenceStore.correlateExecution()` matches simulated stimuli against candidate target responses using three ordered criteria:
1. **Deterministic Correlation Key Match:** `candidate.correlationKey === stimulus.correlationKey`.
2. **Explicit Scenario Tag Match:** `candidate.scenarioId === scenarioId`.
3. **Trigger Event Type + Temporal Window Match:** `candidate.triggerEventType` matches a stimulus `eventType` and `candidate.timestampMs` falls within `[firstStimulusTs - 1000ms, lastStimulusTs + 30000ms]`.

Every matched detection generates an immutable `evidence_records` row documenting:
- `stimulusEventId` and `stimulusTimestampMs`
- `targetTimestampMs`
- `detectionLatencyMs` (`targetTimestampMs - stimulusTimestampMs` when `>= 0`)
- `responseLatencyMs` (when exposed by target telemetry)
- Human-auditable `relationshipExplanation` stating whether correlation occurred via exact `correlationKey` or bounded temporal window.

---

## 4. Duplicate Event & Alert Handling

- **Collector Deduplication (`recordEvent`):** Tracks per-observation fingerprints (`ext:<source>:<externalEventId>` or content hash). Repeated deliveries of an identical gateway/webhook event ID are persisted with `is_duplicate = 1` so audit history stays complete without inflating burst counts.
- **Target Alert Deduplication (`correlateExecution`):** Tracks `alertDedupeKey` (`<alertType>:<correlationKey|triggerEventType|scenarioId>`). Subsequent alerts for an already-correlated stimulus are recorded separately in `duplicateAlerts` (`role: 'DUPLICATE_TARGET_ALERT'`) and feed directly into `Duplicate-Alert Rate`.
