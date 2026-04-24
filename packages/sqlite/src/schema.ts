/**
 * Single-table schema for llmmeter calls. Designed for fast aggregations on
 * the dashboard side. Indexes cover the common filter dimensions.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -20000;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_meta(key, value) VALUES('version', '${SCHEMA_VERSION}');

CREATE TABLE IF NOT EXISTS calls (
  id              TEXT PRIMARY KEY,
  trace_id        TEXT NOT NULL,
  parent_id       TEXT,
  ts              INTEGER NOT NULL,
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
  cost_usd        REAL,
  status          TEXT NOT NULL,
  error_class     TEXT,
  error_message   TEXT,
  retry_count     INTEGER,
  user_id         TEXT,
  feature         TEXT,
  conversation_id TEXT,
  meta_json       TEXT,
  prompt_hash     TEXT NOT NULL,
  prompt_json     TEXT,
  completion_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_calls_ts          ON calls(ts);
CREATE INDEX IF NOT EXISTS idx_calls_trace       ON calls(trace_id);
CREATE INDEX IF NOT EXISTS idx_calls_provider    ON calls(provider, model);
CREATE INDEX IF NOT EXISTS idx_calls_user        ON calls(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_calls_feature     ON calls(feature, ts);
CREATE INDEX IF NOT EXISTS idx_calls_prompt_hash ON calls(prompt_hash);
CREATE INDEX IF NOT EXISTS idx_calls_status      ON calls(status, ts);
`;
