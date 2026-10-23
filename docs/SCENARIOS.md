# Scenario Library Catalog (38 Versioned Scenarios)

> **Creator:** `MADE BY TANVEER`  
> **Catalog Version:** `1.0.0` (`src/scenarios/catalog/`)

All scenarios execute inside the non-destructive simulation engine (`SIMULATION_MODE=true`). Every scenario defines a unique ID, semantic version, risk category, preconditions, configurable parameters, expected outcome, event sequence, programmatic assertions, timeout, cancellation policy, evidence references, cleanup plan, and final classification.

---

## Category A — Event Detection (`EVENT_DETECTION`)

| ID | Version | Title | Affected Capability | Default Stimuli |
| --- | --- | --- | --- | --- |
| `ED-001` | `1.0.0` | Suspicious Channel Creation and Deletion Sequences | Anti-Channel-Nuke Detection | 3 `CHANNEL_CREATE` + 3 `CHANNEL_DELETE` |
| `ED-002` | `1.0.0` | Suspicious Role Creation and Deletion Patterns | Anti-Role-Wipe Detection | 3 `ROLE_CREATE` + 3 `ROLE_DELETE` |
| `ED-003` | `1.0.0` | Dangerous Permission Escalation Changes | Privilege Escalation Guard | 2 `ROLE_PERMISSION_ESCALATION` (`Administrator`, `ManageGuild`) |
| `ED-004` | `1.0.0` | Simulated Mass-Ban and Mass-Kick Bursts | Anti-Mass-Ban / Anti-Mass-Kick | 4 `MEMBER_BAN_ADD` + 4 `MEMBER_KICK` |
| `ED-005` | `1.0.0` | Suspicious Webhook Creation and Mutation | Anti-Webhook Abuse Detection | 4 `WEBHOOK_CREATE` |
| `ED-006` | `1.0.0` | Unexpected Unverified Bot Additions | Anti-Rogue-Bot Quarantine | 1 `BOT_ADD_UNVERIFIED` |
| `ED-007` | `1.0.0` | Unusual Guild Configuration Changes | Guild Settings Integrity Protection | 2 `GUILD_CONFIG_DANGEROUS_UPDATE` |

---

## Category B — Timing & Correlation (`TIMING_CORRELATION`)

| ID | Version | Title | Affected Capability | Behavior Tested |
| --- | --- | --- | --- | --- |
| `TC-001` | `1.0.0` | Rapid High-Frequency Event Bursts | Sliding-Window Burst Correlation | 6 channel deletions at 5ms spacing |
| `TC-002` | `1.0.0` | Duplicate Event Delivery Handling | Duplicate Event Deduplication | 3 deliveries of identical `externalEventId` |
| `TC-003` | `1.0.0` | Out-of-Order Event Sequence Correlation | Out-of-Order Event Ordering | Non-monotonic offsets `[+200ms, +0ms, +100ms]` |
| `TC-004` | `1.0.0` | Missing Intermediate Events Resilience | Partial Event Stream Correlation | Dropped intermediate frames with terminal ban indicator |
| `TC-005` | `1.0.0` | Delayed Audit-Log Availability | Asynchronous Audit-Log Attribution | Gateway event followed by delayed audit entry (+40ms) |
| `TC-006` | `1.0.0` | Delayed Target Detection Evaluation | Detection Latency Bound Enforcement | Enforces `<= 3000ms` detection budget |
| `TC-007` | `1.0.0` | Simultaneous Multi-Vector Suspicious Events | Cross-Vector Incident Correlation | Concurrent channel + role + webhook stimuli (`0ms` delta) |
| `TC-008` | `1.0.0` | Repeated Alerts and Alert-Storm Correlation | Alert Storm Coalescing | Verifies `0` duplicate target alerts under 5-event burst |
| `TC-009` | `1.0.0` | Events Separated by Configurable Intervals | Low-and-Slow Window Accumulation | Spaced channel deletions across configurable intervals |

---

## Category C — Platform & Collector Reliability (`RELIABILITY`)

| ID | Version | Title | Affected Capability | Verification Probe |
| --- | --- | --- | --- | --- |
| `REL-001` | `1.0.0` | Discord API 5xx Error Handling | Discord REST Error Resilience | Bounded retry recovery over injected HTTP `502` faults |
| `REL-002` | `1.0.0` | Discord 429 Rate-Limit Backoff Compliance | Discord Rate-Limit Compliance | Verifies strict `retry_after` wait compliance without bypass |
| `REL-003` | `1.0.0` | Gateway Disconnection Resilience | Gateway Disconnection Survival | Confirms buffered timeline & SQLite persistence across `1001` drop |
| `REL-004` | `1.0.0` | Gateway Reconnection and Sequence Continuity | Gateway Reconnection Continuity | Confirms strictly monotonic `sequenceNo` across resume |
| `REL-005` | `1.0.0` | Auxiliary Collector Failure Isolation | Collector Fault Isolation | Contains auxiliary collector exceptions without crashing engine |
| `REL-006` | `1.0.0` | Database Error Rollback and Integrity Preservation | SQLite Transaction Atomicity | Nested `SAVEPOINT` constraint rollback + `PRAGMA integrity_check` |
| `REL-007` | `1.0.0` | Process Restart Hygiene (Zero Auto-Resume) | Restart Crash Hygiene | Verifies startup reconciler prevents auto-resuming crashed runs |
| `REL-008` | `1.0.0` | Partial Scenario Step Failure Containment | Partial Step Failure Containment | Preserves prior timeline steps when a sub-step warns |
| `REL-009` | `1.0.0` | Cancellation During Active Execution | Immediate Cancellation Signal Propagation | Aborts a 10s sleep in `<250ms` with `0` leaked timers |
| `REL-010` | `1.0.0` | Recovery After a Failed Test | Post-Failure Engine Recovery | Confirms fresh state machine reaches `COMPLETED` after prior `FAILED` |

---

## Category D — False-Positive Resistance (`FALSE_POSITIVE_RESISTANCE`)

| ID | Version | Title | Affected Capability | Expected Target Behavior |
| --- | --- | --- | --- | --- |
| `FPR-001` | `1.0.0` | Legitimate Administrator Moderation Actions | Allowlisted Admin False-Positive Suppression | `0` false-positive alerts |
| `FPR-002` | `1.0.0` | Normal Channel Maintenance Operations | Channel Maintenance Noise Filtering | `0` false-positive alerts |
| `FPR-003` | `1.0.0` | Benign Role Color and Hoist Updates | Permission-Diff Role Inspection | `0` false-positive alerts |
| `FPR-004` | `1.0.0` | Routine Authorized Webhook Rotation | Benign Webhook Maintenance Filtering | `0` false-positive alerts |
| `FPR-005` | `1.0.0` | Authorized Non-Degrading Guild Configuration Changes | Guild Config Security-Impact Classification | `0` false-positive alerts |
| `FPR-006` | `1.0.0` | Multiple Benign Actions Occurring Rapidly | Rapid Benign Burst Differentiation | `0` false-positive alerts on non-privileged onboarding wave |

---

## Category E — Incident Response (`INCIDENT_RESPONSE`)

| ID | Version | Title | Affected Capability | Assertion Checked |
| --- | --- | --- | --- | --- |
| `IR-001` | `1.0.0` | Detection-to-Alert Latency Evaluation | Incident Alerting Latency | Detection-to-alert `<= 2500ms` |
| `IR-002` | `1.0.0` | Detection-to-Response Mitigation Latency | Automated Mitigation Latency | Detection-to-response `<= 4000ms` when exposed |
| `IR-003` | `1.0.0` | Incident Evidence Retention Verification | Forensic Evidence Retention | `evidenceRetained === true` when exposed |
| `IR-004` | `1.0.0` | Incident Duplicate Alert Deduplication Control | Incident Alert Deduplication | `<= 0` duplicate alerts across 4-event incident |
| `IR-005` | `1.0.0` | Honest Reporting of Failed Mitigation Actions | Honest Failed-Action Telemetry | Reports `actionSucceeded === false` on hierarchy-blocked actor |
| `IR-006` | `1.0.0` | Post-Incident Recovery State Verification | Post-Incident Recovery | `recovered === true` when exposed |
