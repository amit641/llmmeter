/**
 * Integration tests for the Postgres sink.
 *
 * Spins up a real Postgres in Docker via testcontainers. If Docker isn't
 * available we skip gracefully so the regular unit-test pass on CI/dev
 * machines without a daemon doesn't fail.
 *
 * Force-run with: `pnpm --filter llmmeter-postgres test:integration`
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LLMCallRecord } from "llmmeter-core";
import { aggregateByBucket, listCalls, postgresSink, pruneOlderThan, topByDimension, totals } from "./index.js";

// Run integration tests only when explicitly opted in (requires Docker).
//   pnpm --filter llmmeter-postgres test:integration
const RUN_INTEGRATION = process.env.LLMMETER_PG_INTEGRATION === "1";
const d = RUN_INTEGRATION ? describe : describe.skip;

const baseRecord = (overrides: Partial<LLMCallRecord> = {}): LLMCallRecord => ({
  id: `id-${Math.random().toString(36).slice(2)}`,
  traceId: "T",
  ts: Date.now(),
  provider: "openai",
  model: "gpt-4o-mini",
  operation: "chat",
  durationMs: 100,
  tokens: { input: 10, output: 5 },
  costUsd: 0.0001,
  status: "ok",
  promptHash: "hash",
  ...overrides,
});

d("postgresSink (live DB)", () => {
  let container: any;
  let pool: any;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const { Pool } = await import("pg");
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it("creates the schema and writes records", async () => {
    const sink = postgresSink({ pool, batchSize: 2, flushIntervalMs: 50 });
    sink.write(baseRecord({ id: "a", feature: "chat", userId: "u1" }));
    sink.write(baseRecord({ id: "b", feature: "rag", userId: "u2" }));
    await sink.flush();
    const rows = await listCalls(pool);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await sink.close();
  });

  it("aggregates by totals and dimension", async () => {
    const sink = postgresSink({ pool });
    for (let i = 0; i < 5; i++) {
      sink.write(baseRecord({ id: `t-${i}`, feature: i < 3 ? "chat" : "rag", costUsd: 0.001 }));
    }
    await sink.flush();
    const t = await totals(pool, { feature: "chat" });
    expect(Number(t.total_calls)).toBeGreaterThanOrEqual(3);
    expect(Number(t.total_cost_usd)).toBeGreaterThan(0);
    const top = await topByDimension(pool, "feature");
    expect(top.length).toBeGreaterThanOrEqual(2);
    await sink.close();
  });

  it("buckets time-series", async () => {
    const sink = postgresSink({ pool });
    const now = Date.now();
    sink.write(baseRecord({ id: "ts1", ts: now - 60_000 }));
    sink.write(baseRecord({ id: "ts2", ts: now - 30_000 }));
    sink.write(baseRecord({ id: "ts3", ts: now }));
    await sink.flush();
    const buckets = await aggregateByBucket(pool, 60, { fromTs: now - 120_000 });
    expect(buckets.length).toBeGreaterThanOrEqual(1);
    await sink.close();
  });

  it("prunes old records", async () => {
    const sink = postgresSink({ pool });
    sink.write(baseRecord({ id: "old", ts: 1 }));
    await sink.flush();
    const deleted = await pruneOlderThan(pool, 1000);
    expect(deleted).toBeGreaterThanOrEqual(1);
    await sink.close();
  });
});

// Tiny smoke test that always runs: verifies postgresSink throws on missing config.
describe("postgresSink (offline)", () => {
  it("throws when no pool/connectionString supplied", () => {
    expect(() => postgresSink({})).toThrow();
  });
});
