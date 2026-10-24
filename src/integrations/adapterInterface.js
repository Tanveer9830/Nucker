/**
 * Documented Target Integration Adapter Interface (Part 6)
 * Any target security system adapter must extend TargetIntegrationAdapter so the
 * observation workflow and scenario engine remain decoupled from transport specifics.
 */
export class TargetIntegrationAdapter {
  constructor({ name = 'GenericTargetAdapter' } = {}) {
    this.adapterName = name;
  }

  /**
   * Returns current adapter health, configured data sources, and telemetry availability.
   */
  async getHealth() {
    throw new Error('TargetIntegrationAdapter.getHealth() must be implemented by subclass.');
  }

  /**
   * Establishes target identity strictly from verified configuration or verified telemetry.
   * Must NEVER guess when multiple candidate bots exist in a guild.
   */
  async identifyTarget(_guildMetadata) {
    throw new Error('TargetIntegrationAdapter.identifyTarget() must be implemented by subclass.');
  }

  /**
   * Loads and validates available external telemetry (JSON logs, incident reports,
   * detection histories, webhook buffers, documented test-probe responses).
   */
  async collectTelemetry(_options = {}) {
    throw new Error('TargetIntegrationAdapter.collectTelemetry() must be implemented by subclass.');
  }

  /**
   * Returns whether a specific capability or internal state is exposed by the target.
   * Unexposed internal states must return { available: false, reason }.
   */
  getCapabilityVisibility(_capabilityKey) {
    return {
      available: false,
      reason: 'Capability visibility not declared by adapter.'
    };
  }
}
