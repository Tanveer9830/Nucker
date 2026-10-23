import { EVIDENCE_SOURCES, EVIDENCE_SOURCE_VALUES } from '../utils/constants.js';
import { generateId, sha256Hex } from '../utils/ids.js';
import { redactSecrets } from '../utils/redaction.js';

const VALID_EVIDENCE_SOURCES = new Set(EVIDENCE_SOURCE_VALUES);

export class InvalidEvidenceSourceError extends Error {
  constructor(sourceType) {
    super(
      `Invalid or unlabeled evidence source "${sourceType}". Must be one of: ${EVIDENCE_SOURCE_VALUES.join(', ')}`
    );
    this.name = 'InvalidEvidenceSourceError';
  }
}

export class EvidenceStore {
  constructor({ repositories, explicitSecrets = [], logger = null }) {
    this.repositories = repositories;
    this.explicitSecrets = explicitSecrets;
    this.logger = logger;
    this._sequenceCounters = new Map(); // observationId -> int
    this._seenEventFingerprints = new Map(); // observationId -> Set<string>
  }

  assertValidSource(sourceType) {
    if (!VALID_EVIDENCE_SOURCES.has(sourceType)) {
      throw new InvalidEvidenceSourceError(sourceType);
    }
  }

  nextSequence(observationId) {
    const next = (this._sequenceCounters.get(observationId) || 0) + 1;
    this._sequenceCounters.set(observationId, next);
    return next;
  }

  /**
   * Records a normalized event with automatic duplicate detection and strict source labeling.
   */
  recordEvent({
    observationId,
    executionId = null,
    scenarioId = null,
    eventType,
    sourceType,
    actorType = 'SIMULATOR',
    correlationKey = null,
    externalEventId = null,
    isMaliciousStimulus = false,
    eventTimestampMs = Date.now(),
    payload = {}
  }) {
    this.assertValidSource(sourceType);
    const safePayload = redactSecrets(payload, this.explicitSecrets);

    let seenSet = this._seenEventFingerprints.get(observationId);
    if (!seenSet) {
      seenSet = new Set();
      this._seenEventFingerprints.set(observationId, seenSet);
    }

    const dedupeKey = externalEventId
      ? `ext:${sourceType}:${externalEventId}`
      : `hash:${sha256Hex({
          executionId,
          eventType,
          sourceType,
          correlationKey,
          eventTimestampMs,
          safePayload
        })}`;

    const isDuplicate = seenSet.has(dedupeKey);
    seenSet.add(dedupeKey);

    const sequenceNo = this.nextSequence(observationId);
    const eventId = generateId('evt');

    this.repositories.insertNormalizedEvent({
      eventId,
      observationId,
      executionId,
      scenarioId,
      sequenceNo,
      eventType,
      sourceType,
      actorType,
      correlationKey,
      isDuplicate,
      isMaliciousStimulus,
      eventTimestampMs,
      payload: safePayload
    });

    return {
      eventId,
      sequenceNo,
      isDuplicate,
      sourceType,
      eventTimestampMs,
      correlationKey
    };
  }

  /**
   * Records an immutable evidence item with strict source labeling and relationship explanation.
   */
  recordEvidence({
    observationId,
    executionId = null,
    scenarioId = null,
    sourceType,
    correlationKey = null,
    summary,
    relationshipExplanation,
    metadata = {}
  }) {
    this.assertValidSource(sourceType);
    if (!summary || typeof summary !== 'string') {
      throw new Error('Evidence summary is required.');
    }
    if (!relationshipExplanation || typeof relationshipExplanation !== 'string') {
      throw new Error('Evidence relationshipExplanation is required.');
    }

    const safeMeta = redactSecrets(metadata, this.explicitSecrets);
    return this.repositories.insertEvidenceRecord({
      observationId,
      executionId,
      scenarioId,
      sourceType,
      correlationKey,
      summary,
      relationshipExplanation,
      metadata: safeMeta
    });
  }

  /**
   * Correlates simulated stimulus events for a scenario execution against target Astra Astra
   * detections, alerts, and mitigation responses without ever conflating evidence source categories.
   */
  correlateExecution({
    observationId,
    executionId,
    scenarioId,
    stimulusEvents = [],
    targetTelemetryEvents = [],
    liveDiscordEvents = [],
    correlationWindowMs = 30000
  }) {
    if (stimulusEvents.length === 0) {
      return {
        telemetryAvailable: targetTelemetryEvents.length > 0 || liveDiscordEvents.length > 0,
        matchedDetections: [],
        unmatchedStimuli: [],
        duplicateAlerts: [],
        falsePositiveAlerts: [],
        detectionLatenciesMs: [],
        responseLatenciesMs: [],
        evidenceReferences: []
      };
    }

    const firstStimulusTs = Math.min(...stimulusEvents.map((e) => e.eventTimestampMs));
    const lastStimulusTs = Math.max(...stimulusEvents.map((e) => e.eventTimestampMs));
    const stimulusCorrelationKeys = new Set(
      stimulusEvents.map((e) => e.correlationKey).filter(Boolean)
    );
    const stimulusTypes = new Set(stimulusEvents.map((e) => e.eventType));

    // Filter candidate target responses strictly by correlationKey or scenario/temporal window
    const allTargetCandidates = [
      ...targetTelemetryEvents.map((t) => ({
        ...t,
        evidenceSource: EVIDENCE_SOURCES.IMPORTED_ASTRA_TELEMETRY
      })),
      ...liveDiscordEvents.map((l) => ({
        ...l,
        evidenceSource: EVIDENCE_SOURCES.LIVE_DISCORD_OBSERVATION
      }))
    ];

    const matchedDetections = [];
    const duplicateAlerts = [];
    const detectionLatenciesMs = [];
    const responseLatenciesMs = [];
    const evidenceReferences = [];
    const seenAlertKeys = new Set();

    for (const candidate of allTargetCandidates) {
      const candidateTs = candidate.timestampMs ?? candidate.eventTimestampMs;
      const keyMatch =
        candidate.correlationKey && stimulusCorrelationKeys.has(candidate.correlationKey);
      const scenarioMatch = candidate.scenarioId && candidate.scenarioId === scenarioId;
      const typeAndWindowMatch =
        candidate.triggerEventType &&
        stimulusTypes.has(candidate.triggerEventType) &&
        candidateTs >= firstStimulusTs - 1000 &&
        candidateTs <= lastStimulusTs + correlationWindowMs;

      if (!keyMatch && !scenarioMatch && !typeAndWindowMatch) {
        continue;
      }

      const alertDedupeKey = `${candidate.alertType || candidate.kind || 'DETECTION'}:${
        candidate.correlationKey || candidate.triggerEventType || scenarioId
      }`;

      if (seenAlertKeys.has(alertDedupeKey) || candidate.isDuplicate) {
        duplicateAlerts.push(candidate);
        const dupEv = this.recordEvidence({
          observationId,
          executionId,
          scenarioId,
          sourceType: candidate.evidenceSource,
          correlationKey: candidate.correlationKey || null,
          summary: `Duplicate target alert observed for ${alertDedupeKey}`,
          relationshipExplanation: `Target emitted an additional alert matching stimulus correlation (${alertDedupeKey}) after initial detection was already recorded.`,
          metadata: {
            candidateId: candidate.id || null,
            timestampMs: candidateTs,
            duplicate: true
          }
        });
        evidenceReferences.push({
          evidenceId: dupEv.evidenceId,
          sourceType: dupEv.sourceType,
          role: 'DUPLICATE_TARGET_ALERT'
        });
        continue;
      }

      seenAlertKeys.add(alertDedupeKey);

      // Compute detection latency relative to matching stimulus timestamp
      const anchorStimulus =
        stimulusEvents.find((s) => s.correlationKey && s.correlationKey === candidate.correlationKey) ||
        stimulusEvents[0];

      const rawDetectDelta = candidateTs - anchorStimulus.eventTimestampMs;
      const detectionLatencyMs = rawDetectDelta >= 0 ? rawDetectDelta : null;
      if (detectionLatencyMs !== null) {
        detectionLatenciesMs.push(detectionLatencyMs);
      }

      let responseLatencyMs = null;
      if (typeof candidate.responseTimestampMs === 'number') {
        const respDelta = candidate.responseTimestampMs - candidateTs;
        if (respDelta >= 0) {
          responseLatencyMs = respDelta;
          responseLatenciesMs.push(respDelta);
        }
      } else if (typeof candidate.responseLatencyMs === 'number' && candidate.responseLatencyMs >= 0) {
        responseLatencyMs = candidate.responseLatencyMs;
        responseLatenciesMs.push(responseLatencyMs);
      }

      const evRecord = this.recordEvidence({
        observationId,
        executionId,
        scenarioId,
        sourceType: candidate.evidenceSource,
        correlationKey: candidate.correlationKey || anchorStimulus.correlationKey || null,
        summary: `Target response (${candidate.action || candidate.kind || 'ALERT'}) correlated to stimulus ${anchorStimulus.eventType}`,
        relationshipExplanation: keyMatch
          ? `Matched deterministically via correlationKey="${candidate.correlationKey}" between simulated event ${anchorStimulus.eventId} (t=${anchorStimulus.eventTimestampMs}) and target event (t=${candidateTs}).`
          : `Matched within ${correlationWindowMs}ms correlation window between simulated event ${anchorStimulus.eventId} (t=${anchorStimulus.eventTimestampMs}) and target event (t=${candidateTs}).`,
        metadata: {
          stimulusEventId: anchorStimulus.eventId,
          stimulusTimestampMs: anchorStimulus.eventTimestampMs,
          targetTimestampMs: candidateTs,
          detectionLatencyMs,
          responseLatencyMs,
          actionSucceeded: candidate.actionSucceeded ?? null,
          retainedEvidenceInTarget: candidate.evidenceRetained ?? null,
          recoveredState: candidate.recovered ?? null,
          rawSummary: candidate.summary || null
        }
      });

      evidenceReferences.push({
        evidenceId: evRecord.evidenceId,
        sourceType: evRecord.sourceType,
        role: 'TARGET_RESPONSE'
      });

      matchedDetections.push({
        ...candidate,
        anchorStimulusEventId: anchorStimulus.eventId,
        detectionLatencyMs,
        responseLatencyMs,
        evidenceId: evRecord.evidenceId
      });
    }

    const matchedStimulusIds = new Set(matchedDetections.map((m) => m.anchorStimulusEventId));
    const unmatchedStimuli = stimulusEvents.filter((s) => !matchedStimulusIds.has(s.eventId));

    return {
      telemetryAvailable: targetTelemetryEvents.length > 0 || liveDiscordEvents.length > 0,
      matchedDetections,
      unmatchedStimuli,
      duplicateAlerts,
      detectionLatenciesMs,
      responseLatenciesMs,
      evidenceReferences
    };
  }

  clearObservationCache(observationId) {
    this._sequenceCounters.delete(observationId);
    this._seenEventFingerprints.delete(observationId);
  }
}
