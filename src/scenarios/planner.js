import { RISK_CATEGORIES } from '../utils/constants.js';
import { SCENARIO_CATALOG } from './catalog/index.js';

export class TestPlanner {
  constructor({ config, repositories = null, logger = null }) {
    this.config = config;
    this.repositories = repositories;
    this.logger = logger;
  }

  /**
   * Deterministic, evidence-aware scenario planner (Part 4.3).
   * Records explicit rationale for every SELECTED, SKIPPED, and BLOCKED scenario.
   */
  createPlan({
    scenarios = SCENARIO_CATALOG,
    environment = {},
    telemetrySnapshot = { available: false, activeSources: [] },
    timeBudgetMs = null
  } = {}) {
    const effectiveBudgetMs =
      timeBudgetMs ?? Math.max(5000, Math.floor(this.config.maxObservationDurationMs * 0.85));

    const recentFailures = this.repositories
      ? new Set(this.repositories.listRecentScenarioFailures(100).map((f) => f.scenario_id))
      : new Set();

    const openFindingScenarios = this.repositories
      ? new Set(this.repositories.listRecentOpenFindings(100).map((f) => f.scenarioId))
      : new Set();

    const activeBaseline = this.repositories
      ? this.repositories.getActiveBaseline(environment.guildId || null)
      : null;
    const baselineScenarioIds = new Set(
      Object.keys(activeBaseline?.scenarioOutcomes || {})
    );

    const missingPermissions = new Set(environment.missingPermissions || []);
    const collectorHealthy = environment.collectorHealth?.healthy !== false;
    const databaseHealthy = environment.databaseHealth?.healthy !== false;

    const seenIds = new Set();
    const decisions = [];
    const candidateSelections = [];

    for (const scenario of scenarios) {
      if (seenIds.has(scenario.id)) {
        decisions.push({
          scenarioId: scenario.id,
          version: scenario.version,
          decision: 'SKIPPED',
          priorityScore: 0,
          reason: 'Duplicate scenario definition encountered in input list; skipped to avoid duplicate work.'
        });
        continue;
      }
      seenIds.add(scenario.id);

      // Check blocking prerequisites
      if (!databaseHealthy) {
        decisions.push({
          scenarioId: scenario.id,
          version: scenario.version,
          decision: 'BLOCKED',
          priorityScore: 0,
          scenario,
          reason: 'Blocked: SQLite database health check reported unhealthy state.'
        });
        continue;
      }

      if (!collectorHealthy && scenario.riskCategory !== RISK_CATEGORIES.SAFE_INTERNAL) {
        decisions.push({
          scenarioId: scenario.id,
          version: scenario.version,
          decision: 'BLOCKED',
          priorityScore: 0,
          scenario,
          reason: 'Blocked: telemetry/event collector health check failed.'
        });
        continue;
      }

      if (scenario.preconditions?.requiresSimulationMode && !this.config.simulationMode) {
        decisions.push({
          scenarioId: scenario.id,
          version: scenario.version,
          decision: 'BLOCKED',
          priorityScore: 0,
          scenario,
          reason:
            'Blocked: scenario requires SIMULATION_MODE=true for non-destructive execution.'
        });
        continue;
      }

      if (scenario.preconditions?.requiresTargetTelemetry && !telemetrySnapshot.available) {
        decisions.push({
          scenarioId: scenario.id,
          version: scenario.version,
          decision: 'BLOCKED',
          priorityScore: 0,
          scenario,
          reason:
            'Blocked: required Astra Astra telemetry integration is unavailable.'
        });
        continue;
      }

      const requiredPerms = scenario.preconditions?.requiredPermissions || [];
      const missingForScenario = requiredPerms.filter((p) => missingPermissions.has(p));
      if (
        environment.guildConnected &&
        missingForScenario.length > 0 &&
        !telemetrySnapshot.available
      ) {
        decisions.push({
          scenarioId: scenario.id,
          version: scenario.version,
          decision: 'BLOCKED',
          priorityScore: 0,
          scenario,
          reason: `Blocked: bot is missing required guild permission(s) [${missingForScenario.join(
            ', '
          )}] and no imported Astra Astra telemetry is available.`
        });
        continue;
      }

      // Compute deterministic priority score & selection rationale
      let priorityScore = 10;
      const rationaleParts = [];

      if (recentFailures.has(scenario.id)) {
        priorityScore += 50;
        rationaleParts.push('previously failed/partial scenario prioritized for verification');
      }
      if (openFindingScenarios.has(scenario.id)) {
        priorityScore += 40;
        rationaleParts.push('linked to open security finding');
      }
      if (baselineScenarioIds.has(scenario.id)) {
        priorityScore += 30;
        rationaleParts.push('part of active regression baseline');
      }
      if (scenario.riskCategory === RISK_CATEGORIES.SAFE_INTERNAL) {
        priorityScore += 25;
        rationaleParts.push('self-contained platform/collector reliability verification');
      } else if (telemetrySnapshot.available) {
        priorityScore += 25;
        rationaleParts.push(
          `active Astra Astra telemetry (${telemetrySnapshot.activeSources.join(', ')}) available for correlation`
        );
      } else {
        rationaleParts.push(
          'selected for non-destructive stimulus baseline (target outcome will be marked INCONCLUSIVE if telemetry remains absent)'
        );
      }

      candidateSelections.push({
        scenario,
        priorityScore,
        rationale: `Selected (priority=${priorityScore}): ${rationaleParts.join('; ')}.`
      });
    }

    // Sort candidates highest priority first, preserving catalog ID tie-breaker
    candidateSelections.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      return a.scenario.id.localeCompare(b.scenario.id);
    });

    // Apply observation time budget across bounded concurrency lanes
    const concurrency = Math.max(1, this.config.maxConcurrentScenarios || 3);
    let estimatedSequentialMs = 0;
    const selectedScenarios = [];

    for (const candidate of candidateSelections) {
      // Realistic simulation runtime estimate (actual simulation steps take ~25-120ms; cap estimate by min(timeoutMs, 1500ms))
      const estimatedRunMs = Math.min(candidate.scenario.timeoutMs, 1500);
      const projectedWallClockMs = Math.ceil(
        (estimatedSequentialMs + estimatedRunMs) / concurrency
      );

      if (projectedWallClockMs > effectiveBudgetMs && selectedScenarios.length > 0) {
        decisions.push({
          scenarioId: candidate.scenario.id,
          version: candidate.scenario.version,
          decision: 'SKIPPED',
          priorityScore: candidate.priorityScore,
          reason: `Skipped: projected execution wall-clock (${projectedWallClockMs}ms) exceeds remaining observation budget (${effectiveBudgetMs}ms).`
        });
        continue;
      }

      estimatedSequentialMs += estimatedRunMs;
      selectedScenarios.push({
        scenario: candidate.scenario,
        priorityScore: candidate.priorityScore,
        reason: candidate.rationale
      });
      decisions.push({
        scenarioId: candidate.scenario.id,
        version: candidate.scenario.version,
        decision: 'SELECTED',
        priorityScore: candidate.priorityScore,
        reason: candidate.rationale
      });
    }

    const blockedScenarios = decisions.filter((d) => d.decision === 'BLOCKED');
    const skippedScenarios = decisions.filter((d) => d.decision === 'SKIPPED');

    const summary = {
      totalConsidered: scenarios.length,
      selectedCount: selectedScenarios.length,
      blockedCount: blockedScenarios.length,
      skippedCount: skippedScenarios.length,
      telemetryAvailableAtPlanning: Boolean(telemetrySnapshot.available),
      baselineIdUsed: activeBaseline?.baseline_id || null,
      effectiveTimeBudgetMs: effectiveBudgetMs,
      decisions: decisions.map(({ scenario: _omit, ...rest }) => rest)
    };

    this.logger?.info('Prepared autonomous observation scenario plan', {
      selectedCount: summary.selectedCount,
      blockedCount: summary.blockedCount,
      skippedCount: summary.skippedCount
    });

    return {
      selected: selectedScenarios,
      blocked: blockedScenarios,
      skipped: skippedScenarios,
      summary
    };
  }
}
