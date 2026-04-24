import { Pool, type PoolConfig } from "pg";
import type { LLMCallRecord, Sink } from "@llmmeter/core";
import { SCHEMA_SQL } from "./schema.js";

export interface PostgresSinkOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  /** Skip schema bootstrap (assume migrations are applied externally). */
  skipSchemaInit?: boolean;
}

const COLS = [
  "id",
  "trace_id",
  "parent_id",
  "ts",
  "provider",
  "model",
  "operation",
  "duration_ms",
  "ttft_ms",
  "input_tokens",
  "output_tokens",
  "cached_tokens",
  "reasoning_tokens",
  "total_tokens",
  "cost_usd",
  "status",
  "error_class",
  "error_message",
  "retry_count",
  "user_id",
  "feature",
  "conversation_id",
  "meta",
  "prompt_hash",
  "prompt",
  "completion",
] as const;

function recordToValues(r: LLMCallRecord): unknown[] {
  return [
    r.id,
    r.traceId,
    r.parentId ?? null,
    r.ts,
    r.provider,
    r.model,
    r.operation,
    r.durationMs,
    r.ttftMs ?? null,
    r.tokens.input,
    r.tokens.output,
    r.tokens.cachedInput ?? null,
    r.tokens.reasoning ?? null,
    r.tokens.total ?? null,
    r.costUsd,
    r.status,
    r.errorClass ?? null,
    r.errorMessage ?? null,
    r.retryCount ?? null,
    r.userId ?? null,
    r.feature ?? null,
    r.conversationId ?? null,
    r.meta ? JSON.stringify(r.meta) : null,
    r.promptHash,
    r.prompt !== undefined ? JSON.stringify(r.prompt) : null,
    r.completion !== undefined ? JSON.stringify(r.completion) : null,
  ];
}

function buildInsertSql(rowCount: number): string {
  const tuples: string[] = [];
  for (let row = 0; row < rowCount; row++) {
    const placeholders = COLS.map((_, i) => `$${row * COLS.length + i + 1}`).join(",");
    tuples.push(`(${placeholders})`);
  }
  return `INSERT INTO llmmeter_calls (${COLS.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT (id) DO NOTHING`;
}

export function postgresSink(opts: PostgresSinkOptions = {}): Sink {
  if (!opts.pool && !opts.connectionString && !opts.poolConfig) {
    throw new Error("[llmmeter] postgresSink requires `pool`, `connectionString`, or `poolConfig`.");
  }

  const pool = opts.pool ?? new Pool(opts.connectionString ? { connectionString: opts.connectionString } : opts.poolConfig);
  const batchSize = opts.batchSize ?? 50;
  const flushIntervalMs = opts.flushIntervalMs ?? 1000;
  const maxBufferSize = opts.maxBufferSize ?? 5000;

  let buffer: LLMCallRecord[] = [];
  let timer: NodeJS.Timeout | null = null;
  let pending: Promise<void> = Promise.resolve();
  let initialized: Promise<void> | null = null;
  let droppedCount = 0;

  const ensureSchema = async () => {
    if (opts.skipSchemaInit) return;
    if (!initialized) {
      initialized = pool.query(SCHEMA_SQL).then(
        () => undefined,
        (err) => {
          // eslint-disable-next-line no-console
          console.warn("[llmmeter] postgres schema init failed:", err.message);
          initialized = null;
        },
      );
    }
    return initialized;
  };

  const doFlush = async () => {
    if (buffer.length === 0) return;
    await ensureSchema();
    while (buffer.length > 0) {
      const batch = buffer.splice(0, batchSize);
      try {
        const sql = buildInsertSql(batch.length);
        const params = batch.flatMap(recordToValues);
        await pool.query(sql, params);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[llmmeter] postgres flush failed:", (err as Error).message);
        // Don't requeue indefinitely; we logged it.
      }
    }
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      pending = pending.then(doFlush);
    }, flushIntervalMs);
    timer.unref?.();
  };

  return {
    name: "postgres",
    write(record) {
      buffer.push(record);
      if (buffer.length > maxBufferSize) {
        const overflow = buffer.length - maxBufferSize;
        buffer.splice(0, overflow);
        droppedCount += overflow;
        if (droppedCount % 100 === 0) {
          // eslint-disable-next-line no-console
          console.warn(`[llmmeter] postgresSink: buffer overflow, dropped ${droppedCount} records total`);
        }
      }
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
      // Only close the pool if we created it.
      if (!opts.pool) await pool.end();
    },
  };
}

// ---------------- Read API for the dashboard ---------------- //

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

function buildWhere(f: QueryFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => {
    params.push(val);
    clauses.push(`${col} = $${params.length}`);
  };
  if (f.provider) add("provider", f.provider);
  if (f.model) add("model", f.model);
  if (f.feature) add("feature", f.feature);
  if (f.userId) add("user_id", f.userId);
  if (f.status) add("status", f.status);
  if (f.fromTs != null) {
    params.push(f.fromTs);
    clauses.push(`ts >= $${params.length}`);
  }
  if (f.toTs != null) {
    params.push(f.toTs);
    clauses.push(`ts <= $${params.length}`);
  }
  return { sql: clauses.length ? "WHERE " + clauses.join(" AND ") : "", params };
}

export async function listCalls(pool: Pool, filters: QueryFilters = {}) {
  const { sql, params } = buildWhere(filters);
  const limit = Math.min(filters.limit ?? 100, 1000);
  const offset = filters.offset ?? 0;
  const r = await pool.query(
    `SELECT * FROM llmmeter_calls ${sql} ORDER BY ts DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return r.rows;
}

export async function totals(pool: Pool, filters: QueryFilters = {}) {
  const { sql, params } = buildWhere(filters);
  const r = await pool.query(
    `SELECT COUNT(*)::int                AS total_calls,
            COALESCE(SUM(cost_usd),0)::double precision AS total_cost_usd,
            COALESCE(SUM(input_tokens),0)::bigint  AS total_input,
            COALESCE(SUM(output_tokens),0)::bigint AS total_output,
            SUM(CASE WHEN status='error' THEN 1 ELSE 0 END)::int AS errors,
            AVG(duration_ms)::double precision AS avg_duration_ms
       FROM llmmeter_calls ${sql}`,
    params,
  );
  return r.rows[0];
}

export async function aggregateByBucket(
  pool: Pool,
  bucketSeconds: number,
  filters: QueryFilters = {},
) {
  const { sql, params } = buildWhere(filters);
  const bucketMs = bucketSeconds * 1000;
  const r = await pool.query(
    `SELECT
       (ts / ${bucketMs}) * ${bucketMs} AS bucket,
       COUNT(*)::int               AS total_calls,
       COALESCE(SUM(cost_usd),0)::double precision AS total_cost_usd,
       COALESCE(SUM(input_tokens),0)::bigint  AS total_input,
       COALESCE(SUM(output_tokens),0)::bigint AS total_output,
       SUM(CASE WHEN status='error' THEN 1 ELSE 0 END)::int AS errors
     FROM llmmeter_calls ${sql}
     GROUP BY bucket
     ORDER BY bucket ASC`,
    params,
  );
  return r.rows;
}

export async function topByDimension(
  pool: Pool,
  dim: "provider" | "model" | "feature" | "user_id",
  filters: QueryFilters = {},
  limit = 10,
) {
  const allowed = ["provider", "model", "feature", "user_id"];
  if (!allowed.includes(dim)) throw new Error(`invalid dim: ${dim}`);
  const { sql, params } = buildWhere(filters);
  const r = await pool.query(
    `SELECT ${dim} AS key,
            COUNT(*)::int               AS calls,
            COALESCE(SUM(cost_usd),0)::double precision AS cost_usd,
            COALESCE(SUM(input_tokens),0)::bigint  AS input_tokens,
            COALESCE(SUM(output_tokens),0)::bigint AS output_tokens
       FROM llmmeter_calls ${sql}
       GROUP BY ${dim}
       ORDER BY cost_usd DESC
       LIMIT ${Math.min(limit, 100)}`,
    params,
  );
  return r.rows;
}

export async function pruneOlderThan(pool: Pool, beforeTs: number): Promise<number> {
  const r = await pool.query(`DELETE FROM llmmeter_calls WHERE ts < $1`, [beforeTs]);
  return r.rowCount ?? 0;
}
