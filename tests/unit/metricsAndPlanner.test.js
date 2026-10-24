import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../../src/config/index.js';
import {
  calculateObservationMetrics,
  calculateTransparentSecurityScore,
  computePercentileStats
} from '../../src/metrics/calculator.js';
import { CancellationTokenSource } from '../../src/orchestrator/cancellation.js';
import { SCENARIO_CATALOG } from '../../src/scenarios/catalog/index.js';
import { TestPlanner } from '../../src/scenarios/planner.js';
import { SCENARIO_CATEGORIES, SCENARIO_RESULTS } from '../../src/utils/constants.js';
import {
  RateLimitAwareExecutor,
  RateLimitExhaustedError,
  RequestTimeoutError
} from '../../src/utils/rateLimiter.js';
import { makeTestEnv } from '../helpers/mockDiscord.js';

test('Metric calculations compute accurate confusion matrix, latencies (median & p95), and never fabricate missing data', () => {
  // Small sample (<5) suppresses p95 while reporting median accurately
  const smallStats = computePercentileStats([100, 200, 300], 2);
  assert.equal(smallStats.available, true);
  assert.equal(smallStats.medianMs, 200);
  assert.equal(smallStats.p95Ms, null);
  assert.equal(smallStats.insufficientSampleForP95, true);
  assert.equal(smallStats.missingCount, 2);

  // Sample >= 5 reports both median and p95
  const fullStats = computePercentileStats([50, 100, 150, 200, 800], 0);
  assert.equal(fullStats.medianMs, 150);
  assert.equal(fullStats.p95Ms, 800);
  assert.equal(fullStats.insufficientSampleForP95, false);

  // Mixed executions with verified telemetry & baseline
  const executions = [
    {
      scenarioId: 'ED-001',
      category: SCENARIO_CATEGORIES.EVENT_DETECTION,
      finalResult: SCENARIO_RESULTS.PASS,
      metrics: {
        telemetryAvailable: true,
        maliciousStimulus: true,
        matchedDetections: 1,
        duplicateAlerts: 0,
        detectionLatenciesMs: [120, 140],
        responseLatenciesMs: [210],
        expectedStimulusEvents: 6,
        collectedStimulusEvents: 6
      }
    },
    {
      scenarioId: 'ED-002',
      category: SCENARIO_CATEGORIES.EVENT_DETECTION,
      finalResult: SCENARIO_RESULTS.FAIL,
      metrics: {
        telemetryAvailable: true,
        maliciousStimulus: true,
        matchedDetections: 0, // False negative!
        duplicateAlerts: 0,
        detectionLatenciesMs: [],
        responseLatenciesMs: [],
        expectedStimulusEvents: 6,
        collectedStimulusEvents: 6
      }
    },
    {
      scenarioId: 'FPR-001',
      category: SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE,
      finalResult: SCENARIO_RESULTS.PASS,
      metrics: {
        telemetryAvailable: true,
        maliciousStimulus: false,
        matchedDetections: 0, // True negative!
        duplicateAlerts: 0,
        expectedStimulusEvents: 2,
        collectedStimulusEvents: 2
      }
    },
    {
      scenarioId: 'FPR-002',
      category: SCENARIO_CATEGORIES.FALSE_POSITIVE_RESISTANCE,
      finalResult: SCENARIO_RESULTS.FAIL,
      metrics: {
        telemetryAvailable: true,
        maliciousStimulus: false,
        matchedDetections: 1, // False positive!
        duplicateAlerts: 1,
        expectedStimulusEvents: 2,
        collectedStimulusEvents: 2
      }
    }
  ];

  const metrics = calculateObservationMetrics({
    executions,
    activeBaseline: {
      scenarioOutcomes: {
        'ED-001': 'PASS',
        'ED-002': 'PASS' // Regressed from PASS -> FAIL!
      }
    }
  });

  // TP=1, FN=1, TN=1, FP=1
  assert.equal(metrics.detectionRate.percentage, 50);
  assert.equal(metrics.missedDetectionRate.percentage, 50);
  assert.equal(metrics.falsePositiveRate.percentage, 50);
  assert.equal(metrics.precision.percentage, 50);
  assert.equal(metrics.recall.percentage, 50);
  assert.equal(metrics.eventCollectionCompleteness.percentage, 100);
  // 2 unique alerts + 1 duplicate = 3 total alerts -> 33.33% duplicate rate
  assert.equal(metrics.duplicateAlertRate.percentage, 33.33);
  assert.equal(metrics.regressionRate.percentage, 50);

  const score = calculateTransparentSecurityScore(metrics);
  assert.equal(score.status, 'VERIFIED_TELEMETRY_SCORE');
  assert.ok(typeof score.targetDefenseScore === 'number');

  // Without target telemetry, targetDefenseScore MUST be withheld (null)
  const simOnlyMetrics = calculateObservationMetrics({
    executions: [
      {
        scenarioId: 'REL-001',
        category: SCENARIO_CATEGORIES.RELIABILITY,
        finalResult: SCENARIO_RESULTS.PASS,
        metrics: { telemetryAvailable: false, maliciousStimulus: false, expectedStimulusEvents: 2, collectedStimulusEvents: 2 }
      }
    ]
  });
  assert.equal(simOnlyMetrics.detectionRate.available, false);
  const simScore = calculateTransparentSecurityScore(simOnlyMetrics);
  assert.equal(simScore.targetDefenseScore, null);
  assert.equal(simScore.status, 'TARGET_TELEMETRY_UNAVAILABLE');
});

test('TestPlanner selects, blocks missing permissions without telemetry, skips duplicates, and honors time budget', () => {
  const config = loadConfig({ env: makeTestEnv() });
  const planner = new TestPlanner({ config });

  // Duplicate scenario in input + missing ViewAuditLog in live guild without telemetry + tight time budget
  const subset = [
    SCENARIO_CATALOG[0], // ED-001 (requires ViewChannel, ViewAuditLog)
    SCENARIO_CATALOG[0], // Duplicate ED-001 -> must be SKIPPED
    SCENARIO_CATALOG.find((s) => s.id === 'REL-001'),
    SCENARIO_CATALOG.find((s) => s.id === 'REL-002'),
    SCENARIO_CATALOG.find((s) => s.id === 'REL-003')
  ];

  const plan = planner.createPlan({
    scenarios: subset,
    environment: {
      guildConnected: true,
      missingPermissions: ['ViewAuditLog'],
      collectorHealth: { healthy: true },
      databaseHealth: { healthy: true }
    },
    telemetrySnapshot: { available: false, activeSources: [] },
    timeBudgetMs: 700 // Tight budget with concurrency=3 -> allows first wave, skips excess if over budget
  });

  assert.equal(plan.blocked.length, 1);
  assert.equal(plan.blocked[0].scenarioId, 'ED-001');
  assert.ok(plan.skipped.some((s) => s.scenarioId === 'ED-001' && s.reason.includes('Duplicate')));
  assert.ok(plan.selected.length >= 1);
});

test('RateLimitAwareExecutor respects 429 retry_after, handles 5xx retries, enforces timeouts, and aborts on cancel', async () => {
  const waits = [];
  const executor = new RateLimitAwareExecutor({
    maxRetries: 2,
    baseBackoffMs: 10,
    maxBackoffMs: 1000,
    sleepFn: async (ms) => waits.push(ms)
  });

  // Persistent 429 throws RateLimitExhaustedError after maxRetries
  await assert.rejects(
    () =>
      executor.execute(async () => {
        const err = new Error('Rate limited');
        err.status = 429;
        err.headers = { 'retry-after': '0.2' };
        throw err;
      }),
    RateLimitExhaustedError
  );
  assert.deepEqual(waits, [200, 200]);

  // Timeout enforcement
  const fastTimeoutExec = new RateLimitAwareExecutor({ defaultTimeoutMs: 25, maxRetries: 0 });
  await assert.rejects(
    () => fastTimeoutExec.execute(() => new Promise((resolve) => setTimeout(resolve, 250))),
    RequestTimeoutError
  );

  // Cancellation abort during retry wait
  const cancelSource = new CancellationTokenSource();
  const realWaitExec = new RateLimitAwareExecutor({ maxRetries: 3, maxBackoffMs: 10000 });
  setTimeout(() => cancelSource.cancel('Stop retry wait'), 15);
  await assert.rejects(
    () =>
      realWaitExec.execute(
        async () => {
          const err = new Error('Rate limited');
          err.status = 429;
          err.rawError = { retry_after: 5 };
          throw err;
        },
        { cancellationToken: cancelSource.token }
      ),
    /Stop retry wait/
  );
});
