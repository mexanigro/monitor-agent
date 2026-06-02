CREATE TABLE IF NOT EXISTS metrics (
  id SERIAL PRIMARY KEY,
  client_id VARCHAR(100) NOT NULL,
  check_type VARCHAR(50) NOT NULL,
  response_time_ms INTEGER,
  status_code INTEGER,
  success BOOLEAN NOT NULL,
  error TEXT,
  metadata JSONB,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_client_checked
  ON metrics (client_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_client_type_checked
  ON metrics (client_id, check_type, checked_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  client_id VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  check_type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  claude_diagnosis TEXT,
  action_taken TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  notification_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incidents_client
  ON incidents (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_unresolved
  ON incidents (resolved, created_at DESC)
  WHERE resolved = FALSE;

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS baselines (
  client_id VARCHAR(100) NOT NULL,
  check_type VARCHAR(50) NOT NULL,
  avg_response_time_ms INTEGER,
  p95_response_time_ms INTEGER,
  success_rate DECIMAL(5,2),
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_id, check_type)
);
