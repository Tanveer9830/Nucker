import { SCENARIO_CATEGORIES, SCENARIO_RESULTS } from '../utils/constants.js';

export const MIN_SAMPLE_SIZE_FOR_P95 = 5;

export function computePercentileStats(rawSamples = [], missingCount = 0) {
  const valid = rawSamples
    .filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);

  const sampleSize = valid.length;
  if (sampleSize === 0) {
    return {
      available: false,
      medianMs: null,
      p95Ms: null,
      minMs: null,
      maxMs: null,
      sampleSize: 0,
      missingCount,
      p95MinimumSampleSize: MIN_SAMPLE_SIZE_FOR_P95,
      insufficientSampleForP95: true
    };
  }

  const mid = Math.floor(sampleSize / 2);
  const medianMs =
    sampleSize % 2 === 1
      ? valid[mid]
      : Number(((valid[mid - 1] + valid[mid]) / 2).toFixed(2));

  let p95Ms = null;
  let insufficientSampleForP95 = true;
  if (sampleSize >= MIN_SAMPLE_SIZE_FOR_P95) {
    const idx = Math.min(sampleSize - 1, Math.ceil(0.95 * sampleSize) - 1);
    p95Ms = valid[idx];
    insufficientSampleForP95 = false;
  }

  return {
    available: true,
    medianMs,
    p95Ms,
    minMs: valid[0],
    maxMs: valid[sampleSize - 1],
    sampleSize,
    missingCount,
    p95MinimumSampleSize: MIN_SAMPLE_SIZE_FOR_P95,
    insufficientSampleForP95
  };
}

function safeRatio(numerator, denominator, missingReason = 'Denominator is zero') {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return {
      available: false,
      value: null,
      percentage: null,
      numerator: 0,
      denominator: 0,
      missingReason
    };
  }
  const value = Number((numerator / denominator).toFixed(4));
  return {
    available: true,
    value,
    percentage: Number((value * 100).toFixed(2)),
    numerator,
    denominator,
    missingReason: null
  };
}

/**
 * Calculates all 13 Part-8 metrics strictly from observed execution evidence & baseline records.
 * Never fabricates values or sample counts when telemetry is missing.
 */
export function calculateObservationMetrics({
  executions = [],
  plannedCount = null,
  activeBaseline = null
} = {}) {
  const counts = {
    selected:
      plannedCount !== null
        ? plannedCount
        : executions.filter((e) => e.finalResult !== SCENARIO_RESULTS.BLOCKED).length,
    totalExecutions: executions.length,
    passed: 0,
    failed: 0,
    partial: 0,
    blocked: 0,
    inconclusive: 0,
    cancelled: 0
  };

  let truePositives = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;

  let expectedEvents = 0;
  let collectedEvents = 0;

  let totalUniqueAlerts = 0;
  let totalDuplicateAlerts = 0;

  const detectionLatencySamples = [];
  let missingDetectionLatencyCount = 0;

  const responseLatencySamples = [];
  let missingResponseLatencyCount = 0;

  const recoveryTimeSamples = [];
  let missingRecoveryTimeCount = 0;

  for (const exec of executions) {
    const res = exec.finalResult ?? exec.final_result;
    if (res === SCENARIO_RESULTS.PASS) counts.passed += 1;
    else if (res === SCENARIO_RESULTS.FAIL) counts.failed += 1;
    else if (res === SCENARIO_RESULTS.PARTIAL) counts.partial += 1;
    else if (res === SCENARIO_RESULTS.BLOCKED) counts.blocked += 1;
    else if (res === SCENARIO_RESULTS.CANCELLED) counts.cancelled += 1;
    else counts.inconclusive += 1;

    const m = exec.metrics || {};
    if (typeof m.expectedStimulusEvents === 'number') {
      expectedEvents += m.expectedStimulusEvents;
    }
    if (typeof m.collectedStimulusEvents === 'number') {
      collectedEvents += m.collectedStimulusEvents;
    }

    if (typeof m.recoveryTimeMs === 'number' && m.recoveryTimeMs >= 0) {
      recoveryTimeSamples.push(m.recoveryTimeMs);
    } else if (exec.scenarioId === 'REL-010' || exec.scenario_id === 'REL-010') {
      missingRecoveryTimeCount += 1;
    }

    // Confusion matrix & target alert metrics apply ONLY when target telemetry was available
    if (m.telemetryAvailable === true && res !== SCENARIO_RESULTS.BLOCKED && res !== SCENARIO_RESULTS.CANCELLED) {
      const matched = Number(m.matchedDetections ?? 0);
      const dupes = Number(m.duplicateAlerts ?? 0);
      totalUniqueAlerts += matched;
      totalDuplicateAlerts += dupes;

      const category = exec.category;
      if (m.maliciousStimulus === true) {
        if (matched > 0) {
          truePositives += 1;
        } else {
          falseNegatives += 1;
        }

        if (Array.isArray(m.detectionLatenciesMs) && m.detectionLatenciesMs.length > 0) {
          detectionLatencySamples.push(...m.detectionLatenciesMs);
        } else {
          missingDetectionLatencyCount += 1;
        }

        if (Array.isArray(m.responseLatenciesMs) && m.responseLatenciesMs.length > 0) {
          responseLatencySamples.push(...m.responseLatenciesMs);
        } else {
          missingResponseLatencyCount += 1;
        }
      } else if (category === SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE) {
        if (matched > 0) {
          falsePositives += 1;
        } else {
          trueNegatives += 1;
        }
      }
    } else if (m.maliciousStimulus === true) {
      missingDetectionLatencyCount += 1;
      missingResponseLatencyCount += 1;
    }
  }

  const evaluatedDenominator = counts.passed + counts.failed + counts.partial;

  const scenarioPassRate = safeRatio(
    counts.passed,
    evaluatedDenominator,
    'No scenarios reached a conclusive PASS/FAIL/PARTIAL outcome'
  );
  const scenarioFailureRate = safeRatio(
    counts.failed,
    evaluatedDenominator,
    'No scenarios reached a conclusive PASS/FAIL/PARTIAL outcome'
  );

  const detectionRate = safeRatio(
    truePositives,
    truePositives + falseNegatives,
    'Astra Astra telemetry unavailable for malicious-stimulus scenarios'
  );
  const missedDetectionRate = safeRatio(
    falseNegatives,
    truePositives + falseNegatives,
    'Astra Astra telemetry unavailable for malicious-stimulus scenarios'
  );
  const falsePositiveRate = safeRatio(
    falsePositives,
    falsePositives + trueNegatives,
    'Astra Astra telemetry unavailable for benign false-positive scenarios'
  );
  const precision = safeRatio(
    truePositives,
    truePositives + falsePositives,
    'Zero positive target detections observed (TP + FP = 0)'
  );
  const recall = safeRatio(
    truePositives,
    truePositives + falseNegatives,
    'Astra Astra telemetry unavailable for malicious-stimulus scenarios (TP + FN = 0)'
  );

  const detectionLatency = computePercentileStats(
    detectionLatencySamples,
    missingDetectionLatencyCount
  );
  const responseLatency = computePercentileStats(
    responseLatencySamples,
    missingResponseLatencyCount
  );
  const eventCollectionCompleteness = safeRatio(
    collectedEvents,
    expectedEvents,
    'No expected events scheduled'
  );
  const duplicateAlertRate = safeRatio(
    totalDuplicateAlerts,
    totalUniqueAlerts + totalDuplicateAlerts,
    'Zero target alerts observed'
  );
  const recoveryTime = computePercentileStats(recoveryTimeSamples, missingRecoveryTimeCount);

  // Regression calculation against active baseline
  let regressionComparable = 0;
  let regressedCount = 0;
  const regressionsList = [];

  if (activeBaseline && activeBaseline.scenarioOutcomes) {
    const baselineMap = activeBaseline.scenarioOutcomes;
    for (const exec of executions) {
      const sId = exec.scenarioId ?? exec.scenario_id;
      const curResult = exec.finalResult ?? exec.final_result;
      const prevResult = baselineMap[sId];
      if (!prevResult) continue;

      const prevConclusive = ['PASS', 'FAIL', 'PARTIAL'].includes(prevResult);
      const curConclusive = ['PASS', 'FAIL', 'PARTIAL'].includes(curResult);
      if (!prevConclusive || !curConclusive) continue;

      regressionComparable += 1;
      if (prevResult === SCENARIO_RESULTS.PASS && curResult !== SCENARIO_RESULTS.PASS) {
        regressedCount += 1;
        regressionsList.push({
          scenarioId: sId,
          baselineResult: prevResult,
          currentResult: curResult
        });
      }
    }
  }

  const regressionRate = safeRatio(
    regressedCount,
    regressionComparable,
    activeBaseline
      ? 'No overlapping conclusive scenarios between baseline and current run'
      : 'No active regression baseline saved yet'
  );

  return {
    counts,
    confusionMatrix: {
      truePositives,
      falseNegatives,
      falsePositives,
      trueNegatives
    },
    scenarioPassRate,
    scenarioFailureRate,
    detectionRate,
    missedDetectionRate,
    falsePositiveRate,
    precision,
    recall,
    detectionLatency,
    responseLatency,
    eventCollectionCompleteness,
    duplicateAlertRate,
    recoveryTime,
    regressionRate,
    regressionsList
  };
}

/**
 * Computes a transparent, non-fabricated security evaluation score for /security-score.
 * If Astra Astra telemetry is unverified/unavailable, targetDefenseScore is explicitly null (UNVERIFIED).
 */
export function calculateTransparentSecurityScore(metrics) {
  if (!metrics || !metrics.counts) {
    return {
      targetDefenseScore: null,
      platformReliabilityScore: null,
      status: 'NO_DATA',
      explanation: 'No completed observation metrics available yet.',
      components: []
    };
  }

  const completenessScore = metrics.eventCollectionCompleteness?.available
    ? metrics.eventCollectionCompleteness.percentage
    : null;

  const hasTargetMetrics =
    metrics.detectionRate?.available && metrics.falsePositiveRate?.available;

  if (!hasTargetMetrics) {
    return {
      targetDefenseScore: null,
      platformReliabilityScore: metrics.scenarioPassRate?.percentage ?? null,
      status: 'TARGET_TELEMETRY_UNAVAILABLE',
      explanation:
        'Target Astra Astra defensive score is withheld (UNVERIFIED) because detection and false-positive telemetry denominators are unavailable. Platform internal reliability pass rate is reported separately.',
      components: [
        {
          name: 'Platform Internal Reliability Pass Rate',
          weight: 'N/A (standalone)',
          score: metrics.scenarioPassRate?.percentage ?? null
        },
        {
          name: 'Event Collection Completeness',
          weight: 'N/A (standalone)',
          score: completenessScore
        }
      ]
    };
  }

  const recallScore = metrics.recall.percentage; // 0..100
  const fpResistanceScore = Number((100 - metrics.falsePositiveRate.percentage).toFixed(2));
  const duplicateControlScore = metrics.duplicateAlertRate.available
    ? Number((100 - metrics.duplicateAlertRate.percentage).toFixed(2))
    : 100;
  const passRateScore = metrics.scenarioPassRate.available
    ? metrics.scenarioPassRate.percentage
    : 0;

  // Transparent weighted composite:
  // 40% Recall + 25% False-Positive Resistance + 20% Scenario Pass Rate + 15% Duplicate Alert Control
  const composite = Number(
    (
      recallScore * 0.4 +
      fpResistanceScore * 0.25 +
      passRateScore * 0.2 +
      duplicateControlScore * 0.15
    ).toFixed(2)
  );

  return {
    targetDefenseScore: composite,
    platformReliabilityScore: passRateScore,
    status: 'VERIFIED_TELEMETRY_SCORE',
    formula:
      '0.40 * DetectionRecall + 0.25 * (100 - FalsePositiveRate) + 0.20 * ScenarioPassRate + 0.15 * (100 - DuplicateAlertRate)',
    explanation:
      'Computed strictly from verified simulated-to-target correlated evidence denominators.',
    components: [
      { name: 'Detection Recall', weight: 0.4, score: recallScore },
      { name: 'False-Positive Resistance', weight: 0.25, score: fpResistanceScore },
      { name: 'Conclusive Scenario Pass Rate', weight: 0.2, score: passRateScore },
      { name: 'Duplicate-Alert Control', weight: 0.15, score: duplicateControlScore }
    ]
  };
}
