-- Migration 002: Performance Indexes & Audit Query Optimization
-- Creator: MADE BY TANVEER

CREATE INDEX IF NOT EXISTS idx_auth_audit_created_at
  ON authorization_audit_records(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_audit_decision
  ON authorization_audit_records(decision, invoking_user_id);

CREATE INDEX IF NOT EXISTS idx_obs_runs_started_at
  ON observation_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_obs_runs_guild_status
  ON observation_runs(guild_id, overall_status);

CREATE INDEX IF NOT EXISTS idx_scenario_exec_obs
  ON scenario_executions(observation_id, scenario_id);

CREATE INDEX IF NOT EXISTS idx_scenario_exec_result
  ON scenario_executions(scenario_id, final_result, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_obs_exec
  ON normalized_events(observation_id, execution_id, sequence_no);

CREATE INDEX IF NOT EXISTS idx_events_correlation
  ON normalized_events(observation_id, correlation_key);

CREATE INDEX IF NOT EXISTS idx_evidence_obs_exec
  ON evidence_records(observation_id, execution_id, source_type);

CREATE INDEX IF NOT EXISTS idx_findings_obs_severity
  ON findings(observation_id, classification, severity);

CREATE INDEX IF NOT EXISTS idx_baselines_active
  ON regression_baselines(is_active, guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cleanup_obs_status
  ON cleanup_records(observation_id, status);
