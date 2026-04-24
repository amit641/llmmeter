import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { LLMCallRecord, Sink } from "llmmeter-core";
import { SCHEMA_SQL } from "./schema.js";

export interface SqliteSinkOptions {
  /** File path for the SQLite database. Defaults to `./.llmmeter/llmmeter.db`. */
  filePath?: string;
  /** Records per write batch. Defaults to 50. */
  batchSize?: number;
  /** Flush interval in ms. Defaults to 250. */
  flushIntervalMs?: number;
  /** Pre-existing better-sqlite3 Database (advanced). */
  db?: Database.Database;
}

const INSERT_SQL = `
INSERT OR REPLACE INTO calls (
  id, trace_id, parent_id, ts, provider, model, operation,
  duration_ms, ttft_ms,
  input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens,
  cost_usd, status, error_class, error_message, retry_count,
  user_id, feature, conversation_id, meta_json,
  prompt_hash, prompt_json, completion_json
) VALUES (
  @id, @trace_id, @parent_id, @ts, @provider, @model, @operation,
  @duration_ms, @ttft_ms,
  @input_tokens, @output_tokens, @cached_tokens, @reasoning_tokens, @total_tokens,
  @cost_usd, @status, @error_class, @error_message, @retry_count,
  @user_id, @feature, @conversation_id, @meta_json,
  @prompt_hash, @prompt_json, @completion_json
)
`;

function recordToRow(r: LLMCallRecord): Record<string, unknown> {
  return {
    id: r.id,
    trace_id: r.traceId,
    parent_id: r.parentId ?? null,
    ts: r.ts,
    provider: r.provider,
    model: r.model,
    operation: r.operation,
    duration_ms: r.durationMs,
    ttft_ms: r.ttftMs ?? null,
    input_tokens: r.tokens.input,
    output_tokens: r.tokens.output,
    cached_tokens: r.tokens.cachedInput ?? null,
    reasoning_tokens: r.tokens.reasoning ?? null,
    total_tokens: r.tokens.total ?? null,
    cost_usd: r.costUsd,
    status: r.status,
    error_class: r.errorClass ?? null,
    error_message: r.errorMessage ?? null,
    retry_count: r.retryCount ?? null,
    user_id: r.userId ?? null,
    feature: r.feature ?? null,
    conversation_id: r.conversationId ?? null,
    meta_json: r.meta ? JSON.stringify(r.meta) : null,
    prompt_hash: r.promptHash,
    prompt_json: r.prompt !== undefined ? JSON.stringify(r.prompt) : null,
    completion_json: r.completion !== undefined ? JSON.stringify(r.completion) : null,
  };
}

/**
 * SQLite sink. WAL mode, single file. Buffered writes flushed in a transaction.
 * Cheap, durable, perfect for local dev and single-instance prod.
 */
export function sqliteSink(opts: SqliteSinkOptions = {}): Sink {
  const filePath = opts.filePath ?? "./.llmmeter/llmmeter.db";
  const batchSize = opts.batchSize ?? 50;
  const flushIntervalMs = opts.flushIntervalMs ?? 250;

  if (!opts.db) {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch {
      // ignore
    }
  }

  const db = opts.db ?? new Database(filePath);
  db.exec(SCHEMA_SQL);
  const insert = db.prepare(INSERT_SQL);
  const insertMany = db.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) insert.run(row);
  });

  let buffer: LLMCallRecord[] = [];
  let timer: NodeJS.Timeout | null = null;
  let pending: Promise<void> = Promise.resolve();
  let closed = false;

  const doFlush = async () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    try {
      insertMany(batch.map(recordToRow));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[llmmeter] sqlite flush failed:", (err as Error).message);
      buffer = [...batch, ...buffer];
    }
  };

  const scheduleFlush = () => {
    if (timer || closed) return;
    timer = setTimeout(() => {
      timer = null;
      pending = pending.then(doFlush);
    }, flushIntervalMs);
    timer.unref?.();
  };

  return {
    name: "sqlite",
    write(record) {
      if (closed) return;
      buffer.push(record);
      if (buffer.length >= batchSize) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        pending = pending.then(doFlush);
      } else {
        scheduleFlush();
      }
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = pending.then(doFlush);
      await pending;
    },
    async close() {
      await this.flush();
      closed = true;
      try {
        db.close();
      } catch {
        // ignore
      }
    },
  };
}

// ---------------- Read API (used by dashboard / collector) ---------------- //

export interface OpenDbOptions {
  filePath: string;
  readonly?: boolean;
}

export function openDb(opts: OpenDbOptions): Database.Database {
  const db = new Database(opts.filePath, { readonly: opts.readonly === true });
  if (!opts.readonly) {
    db.exec(SCHEMA_SQL);
  }
  return db;
}

export interface AggregateRow {
  bucket: number;
  total_calls: number;
  total_cost_usd: number;
  total_input: number;
  total_output: number;
  errors: number;
}

export interface QueryFilters {
  provider?: string;
  model?: string;
  feature?: string;
  userId?: string;
  status?: "ok" | "error" | "cancelled";
  fromTs?: number;
  toTs?: number;
  limit?: number;
  offset?: number;
}

function buildWhere(f: QueryFilters): { sql: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (f.provider) {
    clauses.push("provider = @provider");
    params.provider = f.provider;
  }
  if (f.model) {
    clauses.push("model = @model");
    params.model = f.model;
  }
  if (f.feature) {
    clauses.push("feature = @feature");
    params.feature = f.feature;
  }
  if (f.userId) {
    clauses.push("user_id = @userId");
    params.userId = f.userId;
  }
  if (f.status) {
    clauses.push("status = @status");
    params.status = f.status;
  }
  if (f.fromTs != null) {
    clauses.push("ts >= @fromTs");
    params.fromTs = f.fromTs;
  }
  if (f.toTs != null) {
    clauses.push("ts <= @toTs");
    params.toTs = f.toTs;
  }
  return {
    sql: clauses.length ? "WHERE " + clauses.join(" AND ") : "",
    params,
  };
}

export function listCalls(db: Database.Database, filters: QueryFilters = {}) {
  const { sql, params } = buildWhere(filters);
  const limit = Math.min(filters.limit ?? 100, 1000);
  const offset = filters.offset ?? 0;
  return db
    .prepare(`SELECT * FROM calls ${sql} ORDER BY ts DESC LIMIT ${limit} OFFSET ${offset}`)
    .all(params);
}

export function aggregateByBucket(
  db: Database.Database,
  bucketSeconds: number,
  filters: QueryFilters = {},
): AggregateRow[] {
  const { sql, params } = buildWhere(filters);
  const bucketMs = bucketSeconds * 1000;
  return db
    .prepare(
      `SELECT
         (ts / ${bucketMs}) * ${bucketMs} AS bucket,
         COUNT(*)                AS total_calls,
         COALESCE(SUM(cost_usd),0) AS total_cost_usd,
         COALESCE(SUM(input_tokens),0)  AS total_input,
         COALESCE(SUM(output_tokens),0) AS total_output,
         SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors
       FROM calls
       ${sql}
       GROUP BY bucket
       ORDER BY bucket ASC`,
    )
    .all(params) as AggregateRow[];
}

export function topByDimension(
  db: Database.Database,
  dim: "provider" | "model" | "feature" | "user_id",
  filters: QueryFilters = {},
  limit = 10,
) {
  const { sql, params } = buildWhere(filters);
  return db
    .prepare(
      `SELECT ${dim} AS key,
              COUNT(*)                AS calls,
              COALESCE(SUM(cost_usd),0) AS cost_usd,
              COALESCE(SUM(input_tokens),0)  AS input_tokens,
              COALESCE(SUM(output_tokens),0) AS output_tokens
         FROM calls
         ${sql}
         GROUP BY ${dim}
         ORDER BY cost_usd DESC
         LIMIT ${Math.min(limit, 100)}`,
    )
    .all(params);
}

export function totals(db: Database.Database, filters: QueryFilters = {}) {
  const { sql, params } = buildWhere(filters);
  return db
    .prepare(
      `SELECT COUNT(*)                AS total_calls,
              COALESCE(SUM(cost_usd),0) AS total_cost_usd,
              COALESCE(SUM(input_tokens),0)  AS total_input,
              COALESCE(SUM(output_tokens),0) AS total_output,
              SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
              AVG(duration_ms) AS avg_duration_ms
         FROM calls ${sql}`,
    )
    .get(params);
}

export function pruneOlderThan(db: Database.Database, beforeTs: number): number {
  const stmt = db.prepare(`DELETE FROM calls WHERE ts < @beforeTs`);
  const r = stmt.run({ beforeTs });
  return r.changes;
}
