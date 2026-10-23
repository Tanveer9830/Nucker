-- Migration 001: Core Schema for Tanveer Ka Beta Newker
-- Creator: MADE BY TANVEER

CREATE TABLE IF NOT EXISTS configuration_metadata (
  config_id TEXT PRIMARY KEY,
  app_version TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  simulation_mode INTEGER NOT NULL,
  require_allowlist INTEGER NOT NULL,
  max_concurrent_scenarios INTEGER NOT NULL,
  max_observation_minutes INTEGER NOT NULL,
  sanitized_snapshot_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS authorization_audit_records (
  audit_id TEXT PRIMARY KEY,
  invoking_user_id TEXT NOT NULL,
  configured_operator_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  action_name TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('ALLOWED', 'DENIED')),
  reason TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenario_definitions (
  scenario_id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  risk_category TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scenario_id, version)
);

CREATE TABLE IF NOT EXISTS observation_runs (
  observation_id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  guild_id TEXT,
  guild_name TEXT,
  target_bot_name TEXT,
  target_bot_id TEXT,
  target_identification_state TEXT NOT NULL,
  integration_status TEXT NOT NULL,
  overall_status TEXT NOT NULL,
  assessment_state TEXT NOT NULL,
  current_stage_index INTEGER NOT NULL DEFAULT 1,
  last_successful_stage TEXT,
  failed_stage TEXT,
  failure_category TEXT,
  failure_message TEXT,
  stages_json TEXT NOT NULL,
  environment_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  approval_summary_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS scenario_executions (
  execution_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  category TEXT NOT NULL,
  risk_category TEXT NOT NULL,
  selection_status TEXT NOT NULL,
  selection_reason TEXT NOT NULL,
  state TEXT NOT NULL,
  final_result TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  assertions_json TEXT NOT NULL,
  state_history_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  FOREIGN KEY (observation_id) REFERENCES observation_runs(observation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS normalized_events (
  event_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  execution_id TEXT,
  scenario_id TEXT,
  sequence_no INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  correlation_key TEXT,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  is_malicious_stimulus INTEGER NOT NULL DEFAULT 0,
  event_timestamp_ms INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES observation_runs(observation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evidence_records (
  evidence_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  execution_id TEXT,
  scenario_id TEXT,
  source_type TEXT NOT NULL,
  correlation_key TEXT,
  sha256_hash TEXT NOT NULL,
  summary TEXT NOT NULL,
  relationship_explanation TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES observation_runs(observation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS findings (
  finding_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  execution_id TEXT,
  scenario_id TEXT NOT NULL,
  classification TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence TEXT NOT NULL,
  affected_capability TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  expected_behavior TEXT NOT NULL,
  observed_behavior TEXT NOT NULL,
  potential_impact TEXT NOT NULL,
  reproduction_procedure TEXT NOT NULL,
  recommended_fix TEXT NOT NULL,
  regression_test TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  recommendation_detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES observation_runs(observation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  report_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL UNIQUE,
  report_type TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  structured_json TEXT NOT NULL,
  rendered_markdown TEXT NOT NULL,
  dm_delivery_status TEXT NOT NULL,
  dm_delivered_at TEXT,
  fallback_status TEXT,
  archive_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES observation_runs(observation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS regression_baselines (
  baseline_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  guild_id TEXT,
  target_bot_id TEXT,
  target_version TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  scenario_outcomes_json TEXT NOT NULL,
  metrics_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES observation_runs(observation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cleanup_records (
  cleanup_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  execution_id TEXT,
  scenario_id TEXT,
  status TEXT NOT NULL,
  planned_actions_json TEXT NOT NULL,
  completed_actions_json TEXT NOT NULL,
  incomplete_actions_json TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  FOREIGN KEY (observation_id) REFERENCES observation_runs(observation_id) ON DELETE CASCADE
);
