import { SCENARIO_RESULTS } from '../../utils/constants.js';

export function assertStimulusTimelineComplete(expectedMinEvents = 1) {
  return {
    id: 'STIMULUS_TIMELINE_COMPLETE',
    targetFacing: false,
    description: `At least ${expectedMinEvents} simulated event(s) must be generated, normalized, and persisted.`,
    evaluate(ctx) {
      const count = ctx.stimulusEvents.length;
      if (count >= expectedMinEvents) {
        return {
          status: SCENARIO_RESULTS.PASS,
          expected: `>= ${expectedMinEvents} persisted stimulus event(s)`,
          observed: `${count} persisted stimulus event(s)`,
          message: `Recorded ${count} simulated stimulus event(s) in timeline.`
        };
      }
      return {
        status: SCENARIO_RESULTS.FAIL,
        expected: `>= ${expectedMinEvents} persisted stimulus event(s)`,
        observed: `${count} persisted stimulus event(s)`,
        message: 'Simulation engine failed to emit complete stimulus sequence.'
      };
    }
  };
}

export function assertTargetDetectionPresent({ minDetections = 1, description = null } = {}) {
  return {
    id: 'TARGET_DETECTION_CORRELATED',
    targetFacing: true,
    description:
      description ||
      `Target Astra Astra must emit at least ${minDetections} correlated detection/alert event(s).`,
    evaluate(ctx) {
      if (!ctx.telemetryAvailable) {
        return {
          status: SCENARIO_RESULTS.INCONCLUSIVE,
          expected: `>= ${minDetections} correlated target detection(s)`,
          observed: 'Target telemetry unavailable',
          message:
            'Astra Astra telemetry is unavailable for this run; missing telemetry is never treated as a missed detection.'
        };
      }
      const matched = ctx.correlation.matchedDetections.length;
      if (matched >= minDetections) {
        return {
          status: SCENARIO_RESULTS.PASS,
          expected: `>= ${minDetections} correlated target detection(s)`,
          observed: `${matched} correlated target detection(s)`,
          message: `Verified ${matched} correlated Astra Astra detection(s) with supporting evidence.`
        };
      }
      return {
        status: SCENARIO_RESULTS.FAIL,
        expected: `>= ${minDetections} correlated target detection(s)`,
        observed: `${matched} correlated target detection(s) despite active telemetry`,
        message:
          'Active Astra Astra telemetry stream did not contain a correlated detection within the evaluation window.'
      };
    }
  };
}

export function assertZeroFalsePositiveAlerts() {
  return {
    id: 'ZERO_FALSE_POSITIVE_ALERTS',
    targetFacing: true,
    description: 'Target Astra Astra must not emit destructive-action alerts or mitigations for benign activity.',
    evaluate(ctx) {
      if (!ctx.telemetryAvailable) {
        return {
          status: SCENARIO_RESULTS.INCONCLUSIVE,
          expected: '0 false-positive alerts',
          observed: 'Target telemetry unavailable',
          message:
            'Astra Astra telemetry is unavailable; cannot confirm false-positive resistance without target visibility.'
        };
      }
      const falsePositives = ctx.correlation.matchedDetections.length;
      if (falsePositives === 0) {
        return {
          status: SCENARIO_RESULTS.PASS,
          expected: '0 false-positive alerts',
          observed: '0 alerts emitted during active telemetry window',
          message: 'Astra Astra correctly ignored benign administrative/maintenance activity.'
        };
      }
      return {
        status: SCENARIO_RESULTS.FAIL,
        expected: '0 false-positive alerts',
        observed: `${falsePositives} false-positive alert(s) correlated to benign stimulus`,
        message: `Astra Astra triggered ${falsePositives} false-positive alert(s) on legitimate activity.`
      };
    }
  };
}

export function assertDetectionLatencyWithin(maxLatencyMs) {
  return {
    id: 'DETECTION_LATENCY_SLA',
    targetFacing: true,
    description: `Detection-to-alert latency must not exceed ${maxLatencyMs}ms.`,
    evaluate(ctx) {
      if (!ctx.telemetryAvailable) {
        return {
          status: SCENARIO_RESULTS.INCONCLUSIVE,
          expected: `<= ${maxLatencyMs}ms`,
          observed: 'Target telemetry unavailable',
          message: 'Detection latency unavailable without Astra Astra telemetry.'
        };
      }
      const latencies = ctx.correlation.detectionLatenciesMs;
      if (latencies.length === 0) {
        return {
          status: SCENARIO_RESULTS.INCONCLUSIVE,
          expected: `<= ${maxLatencyMs}ms`,
          observed: 'No timestamped detection latency sample',
          message: 'No correlated timestamped detection sample available to measure latency.'
        };
      }
      const worst = Math.max(...latencies);
      if (worst <= maxLatencyMs) {
        return {
          status: SCENARIO_RESULTS.PASS,
          expected: `<= ${maxLatencyMs}ms`,
          observed: `max=${worst}ms (${latencies.length} sample(s))`,
          message: `Detection latency (${worst}ms) met the ${maxLatencyMs}ms threshold.`
        };
      }
      return {
        status: SCENARIO_RESULTS.FAIL,
        expected: `<= ${maxLatencyMs}ms`,
        observed: `max=${worst}ms`,
        message: `Detection latency (${worst}ms) exceeded threshold (${maxLatencyMs}ms).`
      };
    }
  };
}

export function assertNoDuplicateTargetAlerts(maxDuplicates = 0) {
  return {
    id: 'DUPLICATE_ALERT_SUPPRESSION',
    targetFacing: true,
    description: `Duplicate target alerts must be <= ${maxDuplicates}.`,
    evaluate(ctx) {
      if (!ctx.telemetryAvailable) {
        return {
          status: SCENARIO_RESULTS.INCONCLUSIVE,
          expected: `<= ${maxDuplicates} duplicate alert(s)`,
          observed: 'Target telemetry unavailable',
          message: 'Cannot measure duplicate alert suppression without Astra Astra telemetry.'
        };
      }
      const dupCount = ctx.correlation.duplicateAlerts.length;
      if (dupCount <= maxDuplicates) {
        return {
          status: SCENARIO_RESULTS.PASS,
          expected: `<= ${maxDuplicates} duplicate alert(s)`,
          observed: `${dupCount} duplicate alert(s)`,
          message: 'Duplicate alerts remained within allowed bounds.'
        };
      }
      return {
        status: SCENARIO_RESULTS.FAIL,
        expected: `<= ${maxDuplicates} duplicate alert(s)`,
        observed: `${dupCount} duplicate alert(s)`,
        message: `Observed ${dupCount} duplicate alert(s) exceeding suppression threshold (${maxDuplicates}).`
      };
    }
  };
}
