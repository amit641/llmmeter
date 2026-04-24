/**
 * Storage abstraction so the dashboard server can talk to SQLite or Postgres
 * with the same interface. Both packages already export the same query shape;
 * we just wrap them.
 */

import type { LLMCallRecord } from "llmmeter-core";

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

export interface Storage {
  totals(f?: QueryFilters): Promise<unknown>;
  listCalls(f?: QueryFilters): Promise<unknown[]>;
  aggregateByBucket(bucketSeconds: number, f?: QueryFilters): Promise<unknown[]>;
  topByDimension(
    dim: "provider" | "model" | "feature" | "user_id",
    f?: QueryFilters,
    limit?: number,
  ): Promise<unknown[]>;
  ingest(records: LLMCallRecord[]): Promise<void>;
  pruneOlderThan(beforeTs: number): Promise<number>;
  close(): Promise<void>;
}

export async function openSqliteStorage(filePath: string): Promise<Storage> {
  const sqlite = await import("llmmeter-sqlite");
  const db = sqlite.openDb({ filePath });
  // sink for ingest
  const sink = sqlite.sqliteSink({ db, batchSize: 50, flushIntervalMs: 100 });
  return {
    async totals(f) {
      return sqlite.totals(db, f);
    },
    async listCalls(f) {
      return sqlite.listCalls(db, f);
    },
    async aggregateByBucket(b, f) {
      return sqlite.aggregateByBucket(db, b, f);
    },
    async topByDimension(dim, f, limit) {
      return sqlite.topByDimension(db, dim, f, limit);
    },
    async ingest(records) {
      for (const r of records) sink.write(r);
      await sink.flush();
    },
    async pruneOlderThan(t) {
      return sqlite.pruneOlderThan(db, t);
    },
    async close() {
      await sink.close();
    },
  };
}

export async function openPostgresStorage(connectionString: string): Promise<Storage> {
  const pg = await import("llmmeter-postgres");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString });
  const sink = pg.postgresSink({ pool, batchSize: 50, flushIntervalMs: 100 });
  return {
    async totals(f) {
      return pg.totals(pool, f);
    },
    async listCalls(f) {
      return pg.listCalls(pool, f);
    },
    async aggregateByBucket(b, f) {
      return pg.aggregateByBucket(pool, b, f);
    },
    async topByDimension(dim, f, limit) {
      return pg.topByDimension(pool, dim, f, limit);
    },
    async ingest(records) {
      for (const r of records) sink.write(r);
      await sink.flush();
    },
    async pruneOlderThan(t) {
      return pg.pruneOlderThan(pool, t);
    },
    async close() {
      await sink.close();
      await pool.end();
    },
  };
}
