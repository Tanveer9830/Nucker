import { SCENARIO_STATES } from '../utils/constants.js';

const LEGAL_TRANSITIONS = Object.freeze({
  [SCENARIO_STATES.PENDING]: new Set([
    SCENARIO_STATES.QUEUED,
    SCENARIO_STATES.VALIDATING,
    SCENARIO_STATES.BLOCKED,
    SCENARIO_STATES.CANCELLED
  ]),
  [SCENARIO_STATES.QUEUED]: new Set([
    SCENARIO_STATES.VALIDATING,
    SCENARIO_STATES.BLOCKED,
    SCENARIO_STATES.CANCELLED
  ]),
  [SCENARIO_STATES.VALIDATING]: new Set([
    SCENARIO_STATES.RUNNING,
    SCENARIO_STATES.BLOCKED,
    SCENARIO_STATES.CANCELLED,
    SCENARIO_STATES.FAILED
  ]),
  [SCENARIO_STATES.RUNNING]: new Set([
    SCENARIO_STATES.CORRELATING,
    SCENARIO_STATES.EVALUATING,
    SCENARIO_STATES.CLEANING_UP,
    SCENARIO_STATES.CANCELLED,
    SCENARIO_STATES.FAILED
  ]),
  [SCENARIO_STATES.CORRELATING]: new Set([
    SCENARIO_STATES.EVALUATING,
    SCENARIO_STATES.CLEANING_UP,
    SCENARIO_STATES.CANCELLED,
    SCENARIO_STATES.FAILED
  ]),
  [SCENARIO_STATES.EVALUATING]: new Set([
    SCENARIO_STATES.CLEANING_UP,
    SCENARIO_STATES.COMPLETED,
    SCENARIO_STATES.CANCELLED,
    SCENARIO_STATES.FAILED
  ]),
  [SCENARIO_STATES.CLEANING_UP]: new Set([
    SCENARIO_STATES.COMPLETED,
    SCENARIO_STATES.CANCELLED,
    SCENARIO_STATES.FAILED
  ]),
  [SCENARIO_STATES.COMPLETED]: new Set(),
  [SCENARIO_STATES.BLOCKED]: new Set(),
  [SCENARIO_STATES.CANCELLED]: new Set(),
  [SCENARIO_STATES.FAILED]: new Set()
});

export class InvalidStateTransitionError extends Error {
  constructor(fromState, toState, executionId) {
    super(
      `Invalid scenario state transition from "${fromState}" to "${toState}" for execution "${executionId}".`
    );
    this.name = 'InvalidStateTransitionError';
    this.fromState = fromState;
    this.toState = toState;
    this.executionId = executionId;
  }
}

export class ScenarioStateMachine {
  constructor(executionId, initialState = SCENARIO_STATES.PENDING) {
    this.executionId = executionId;
    this.state = initialState;
    this.history = [
      {
        from: null,
        to: initialState,
        timestamp: new Date().toISOString(),
        note: 'Initialized'
      }
    ];
  }

  isTerminal() {
    return (
      this.state === SCENARIO_STATES.COMPLETED ||
      this.state === SCENARIO_STATES.BLOCKED ||
      this.state === SCENARIO_STATES.CANCELLED ||
      this.state === SCENARIO_STATES.FAILED
    );
  }

  canTransition(nextState) {
    const allowed = LEGAL_TRANSITIONS[this.state];
    return Boolean(allowed && allowed.has(nextState));
  }

  transition(nextState, note = '') {
    if (this.state === nextState && this.isTerminal()) {
      return this.state;
    }
    if (!this.canTransition(nextState)) {
      throw new InvalidStateTransitionError(this.state, nextState, this.executionId);
    }
    const previous = this.state;
    this.state = nextState;
    this.history.push({
      from: previous,
      to: nextState,
      timestamp: new Date().toISOString(),
      note: note || undefined
    });
    return this.state;
  }

  getHistory() {
    return [...this.history];
  }
}
