import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMCallRecord } from "llmmeter-core";
import {
  aggregateByBucket,
  listCalls,
  openDb,
  pruneOlderThan,
  sqliteSink,
  topByDimension,
  totals,
} from "./index.js";

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "llmmeter-"));
  dbPath = join(tmp, "test.db");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const baseRecord = (over: Partial<LLMCallRecord> = {}): LLMCallRecord => ({
  id: Math.random().toString(36).slice(2),
  traceId: "t1",
  ts: Date.now(),
  provider: "openai",
  model: "gpt-4o-mini",
  operation: "chat",
  durationMs: 120,
  tokens: { input: 100, output: 50, total: 150 },
  costUsd: 0.001,
  status: "ok",
  promptHash: "abc123",
  ...over,
});

describe("sqliteSink", () => {
  it("writes records and survives flush+close", async () => {
    const sink = sqliteSink({ filePath: dbPath, batchSize: 2 });
    sink.write(baseRecord());
    sink.write(baseRecord());
    sink.write(baseRecord({ status: "error", errorClass: "RateLimit" }));
    await sink.flush();
    await sink.close();

    const db = openDb({ filePath: dbPath, readonly: true });
    expect(listCalls(db)).toHaveLength(3);
    db.close();
  });

  it("aggregates totals and per-feature breakdown", async () => {
    const sink = sqliteSink({ filePath: dbPath, batchSize: 100, flushIntervalMs: 5 });
    const now = Date.now();
    sink.write(baseRecord({ ts: now - 1000, feature: "chat", costUsd: 0.5 }));
    sink.write(baseRecord({ ts: now - 500, feature: "chat", costUsd: 0.25 }));
    sink.write(baseRecord({ ts: now, feature: "summarize", costUsd: 0.1 }));
    await sink.flush();

    const db = openDb({ filePath: dbPath, readonly: true });
    const t = totals(db) as { total_calls: number; total_cost_usd: number; errors: number };
    expect(t.total_calls).toBe(3);
    expect(t.total_cost_usd).toBeCloseTo(0.85, 6);

    const byFeature = topByDimension(db, "feature") as Array<{ key: string; cost_usd: number }>;
    expect(byFeature[0]).toEqual(expect.objectContaining({ key: "chat", cost_usd: 0.75 }));
    expect(byFeature[1]).toEqual(expect.objectContaining({ key: "summarize", cost_usd: 0.1 }));

    db.close();
    await sink.close();
  });

  it("buckets aggregations by interval", async () => {
    const sink = sqliteSink({ filePath: dbPath, flushIntervalMs: 5 });
    const base = 1_700_000_000_000;
    sink.write(baseRecord({ ts: base, costUsd: 0.1 }));
    sink.write(baseRecord({ ts: base + 30_000, costUsd: 0.2 }));
    sink.write(baseRecord({ ts: base + 90_000, costUsd: 0.3 }));
    await sink.flush();

    const db = openDb({ filePath: dbPath, readonly: true });
    const buckets = aggregateByBucket(db, 60);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.total_cost_usd).toBeCloseTo(0.3);
    expect(buckets[1]!.total_cost_usd).toBeCloseTo(0.3);
    db.close();
    await sink.close();
  });

  it("prunes older records", async () => {
    const sink = sqliteSink({ filePath: dbPath, flushIntervalMs: 5 });
    const old = Date.now() - 86_400_000 * 30;
    const fresh = Date.now();
    sink.write(baseRecord({ ts: old }));
    sink.write(baseRecord({ ts: old }));
    sink.write(baseRecord({ ts: fresh }));
    await sink.flush();

    const db = openDb({ filePath: dbPath });
    const removed = pruneOlderThan(db, fresh - 1000);
    expect(removed).toBe(2);
    expect(listCalls(db)).toHaveLength(1);
    db.close();
    await sink.close();
  });
});
