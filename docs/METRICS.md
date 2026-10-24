# Metrics & Transparent Scoring Specification

> **Creator:** `MADE BY TANVEER`  
> **Implementation:** `src/metrics/calculator.js`

## 1. Fundamental Measurement Rules

1. **Zero Fabricated Denominators:** Every ratio metric checks `denominator > 0`. When required target telemetry or baseline data is absent, `available` is `false`, `value` is `null`, and an explicit `missingReason` is recorded.
2. **Missing Telemetry Is Never Counted as FN:** Confusion-matrix counts (`TP`, `FN`, `FP`, `TN`) include **only** scenarios executed while `telemetryAvailable === true` and not `BLOCKED` or `CANCELLED`.
3. **Sample-Gated Latency Percentiles:**
   - **Median (`p50`):** Reported whenever `sampleSize >= 1`.
   - **95th Percentile (`p95`):** Reported **only** when `sampleSize >= 5` (`MIN_SAMPLE_SIZE_FOR_P95 = 5`). When `1 <= sampleSize < 5`, `p95Ms` is `null` and `insufficientSampleForP95` is `true`.
   - Every latency object includes `sampleSize` and `missingCount`.

---

## 2. Exact Metric Formulas & Denominators

Let:
- $N_{\text{eval}} = \text{Passed} + \text{Failed} + \text{Partial}$ (scenarios reaching a conclusive assertion state)
- $TP$ = Malicious-stimulus scenarios with active target telemetry where $\text{matchedDetections} \ge 1$
- $FN$ = Malicious-stimulus scenarios with active target telemetry where $\text{matchedDetections} = 0$
- $FP$ = Benign (`FALSE_POSITIVE_RESISTANCE`) scenarios with active target telemetry where $\text{matchedDetections} \ge 1$
- $TN$ = Benign (`FALSE_POSITIVE_RESISTANCE`) scenarios with active target telemetry where $\text{matchedDetections} = 0$

| Metric | Formula | Denominator | Missing Condition |
| --- | --- | --- | --- |
| **Scenario Pass Rate** | $\frac{\text{Passed}}{N_{\text{eval}}}$ | $\text{Passed} + \text{Failed} + \text{Partial}$ | $N_{\text{eval}} = 0$ |
| **Scenario Failure Rate** | $\frac{\text{Failed}}{N_{\text{eval}}}$ | $\text{Passed} + \text{Failed} + \text{Partial}$ | $N_{\text{eval}} = 0$ |
| **Detection Rate** | $\frac{TP}{TP + FN}$ | Malicious scenarios with active telemetry ($TP + FN$) | $TP + FN = 0$ |
| **Missed-Detection Rate** | $\frac{FN}{TP + FN}$ | Malicious scenarios with active telemetry ($TP + FN$) | $TP + FN = 0$ |
| **False-Positive Rate** | $\frac{FP}{FP + TN}$ | Benign FPR scenarios with active telemetry ($FP + TN$) | $FP + TN = 0$ |
| **Precision** | $\frac{TP}{TP + FP}$ | Total positive scenario detections ($TP + FP$) | $TP + FP = 0$ |
| **Recall** | $\frac{TP}{TP + FN}$ | Malicious scenarios with active telemetry ($TP + FN$) | $TP + FN = 0$ |
| **Detection Latency** | $\text{median}(\Delta t_{\text{det}}),\ p_{95}(\Delta t_{\text{det}})$ | $\Delta t_{\text{det}} = t_{\text{alert}} - t_{\text{stimulus}} \ge 0$ | $n = 0$ (or $n < 5$ for $p_{95}$) |
| **Response Latency** | $\text{median}(\Delta t_{\text{resp}}),\ p_{95}(\Delta t_{\text{resp}})$ | $\Delta t_{\text{resp}} = t_{\text{mitigation}} - t_{\text{alert}} \ge 0$ | $n = 0$ (or $n < 5$ for $p_{95}$) |
| **Event Collection Completeness** | $\frac{E_{\text{collected}}}{E_{\text{expected}}}$ | Total scheduled simulated events ($E_{\text{expected}}$) | $E_{\text{expected}} = 0$ |
| **Duplicate-Alert Rate** | $\frac{A_{\text{dup}}}{A_{\text{unique}} + A_{\text{dup}}}$ | Total target alerts ($A_{\text{unique}} + A_{\text{dup}}$) | $A_{\text{unique}} + A_{\text{dup}} = 0$ |
| **Recovery Time** | $\text{median}(\Delta t_{\text{rec}}),\ p_{95}(\Delta t_{\text{rec}})$ | Post-failure state recovery samples (`REL-010`) | $n = 0$ (or $n < 5$ for $p_{95}$) |
| **Regression Rate** | $\frac{S_{\text{regressed}}}{S_{\text{comparable}}}$ | Overlapping conclusive baseline scenarios ($S_{\text{comparable}}$) | No baseline or $S_{\text{comparable}} = 0$ |

Where $S_{\text{regressed}}$ counts scenarios whose active baseline outcome was `PASS` and whose current outcome is `FAIL` or `PARTIAL`.

---

## 3. Transparent Security Score (`/security-score`)

`calculateTransparentSecurityScore(metrics)` separates internal platform health from **Astra Astra** target evaluation:

- **When `Detection Rate` or `False-Positive Rate` is unavailable:**
  - `targetDefenseScore = null` (`UNVERIFIED — Withheld due to missing target telemetry`)
  - `platformReliabilityScore = scenarioPassRate.percentage` (reflecting internal reliability tests `REL-001`–`REL-010` and `TC-002` only).
- **When verified target telemetry denominators exist:**
  $$\text{TargetDefenseScore} = 0.40 \times \text{Recall}_{\%} + 0.25 \times (100 - \text{FPR}_{\%}) + 0.20 \times \text{PassRate}_{\%} + 0.15 \times (100 - \text{DuplicateAlertRate}_{\%})$$
  *(If `DuplicateAlertRate` has 0 alerts, its control term defaults to `100`.)*
