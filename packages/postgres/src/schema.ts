export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS llmmeter_schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO llmmeter_schema_meta(key, value) VALUES('version', '${SCHEMA_VERSION}')
  ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS llmmeter_calls (
  id              TEXT PRIMARY KEY,
  trace_id        TEXT NOT NULL,
  parent_id       TEXT,
  ts              BIGINT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  operation       TEXT NOT NULL,
  duration_ms     INTEGER NOT NULL,
  ttft_ms         INTEGER,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  cached_tokens   INTEGER,
  reasoning_tokens INTEGER,
  total_tokens    INTEGER,
  cost_usd        DOUBLE PRECISION,
  status          TEXT NOT NULL,
  error_class     TEXT,
  error_message   TEXT,
  retry_count     INTEGER,
  user_id         TEXT,
  feature         TEXT,
  conversation_id TEXT,
  meta            JSONB,
  prompt_hash     TEXT NOT NULL,
  prompt          JSONB,
  completion      JSONB
);

CREATE INDEX IF NOT EXISTS idx_llmmeter_calls_ts          ON llmmeter_calls(ts);
CREATE INDEX IF NOT EXISTS idx_llmmeter_calls_trace       ON llmmeter_calls(trace_id);
CREATE INDEX IF NOT EXISTS idx_llmmeter_calls_provider    ON llmmeter_calls(provider, model);
CREATE INDEX IF NOT EXISTS idx_llmmeter_calls_user        ON llmmeter_calls(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_llmmeter_calls_feature     ON llmmeter_calls(feature, ts);
CREATE INDEX IF NOT EXISTS idx_llmmeter_calls_prompt_hash ON llmmeter_calls(prompt_hash);
CREATE INDEX IF NOT EXISTS idx_llmmeter_calls_status      ON llmmeter_calls(status, ts);
`;
