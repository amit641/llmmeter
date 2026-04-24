import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LLMCallRecord } from "@llmmeter/core";
import { createDashboardServer } from "./server.js";
import type { QueryFilters, Storage } from "./storage.js";

function fakeStorage(records: LLMCallRecord[] = []): Storage {
  return {
    async totals() {
      return {
        total_calls: records.length,
        total_cost_usd: records.reduce((s, r) => s + (r.costUsd ?? 0), 0),
      };
    },
    async listCalls(_f?: QueryFilters) {
      return records;
    },
    async aggregateByBucket() {
      return [{ bucket: 0, total_calls: records.length, total_cost_usd: 0 }];
    },
    async topByDimension() {
      return [{ key: "chat", calls: records.length, cost_usd: 0 }];
    },
    async ingest(rs) {
      records.push(...rs);
    },
    async pruneOlderThan() {
      return 0;
    },
    async close() {},
  };
}

let url: string;
let close: () => Promise<void>;

beforeAll(async () => {
  const records: LLMCallRecord[] = [];
  const storage = fakeStorage(records);
  const server = createDashboardServer({
    storage,
    port: 0, // ephemeral; we'll grab the address below
    host: "127.0.0.1",
    ingestToken: "secret123",
  });
  // node http listen with port 0 needs a different path; just pick a port:
  const port = 38437 + Math.floor(Math.random() * 1000);
  const s2 = createDashboardServer({
    storage,
    port,
    host: "127.0.0.1",
    ingestToken: "secret123",
  });
  await s2.listen();
  url = `http://127.0.0.1:${port}`;
  close = () => s2.close();
  // discard the unused server (not actually started)
  void server;
});

afterAll(async () => {
  await close();
});

describe("dashboard server", () => {
  it("serves /api/health", async () => {
    const r = await fetch(`${url}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("requires ingest token", async () => {
    const r = await fetch(`${url}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ records: [] }),
    });
    expect(r.status).toBe(401);
  });

  it("accepts ingest with token and serves totals", async () => {
    const fakeRec: LLMCallRecord = {
      id: "01H",
      traceId: "t",
      ts: Date.now(),
      provider: "openai",
      model: "gpt-4o-mini",
      operation: "chat",
      durationMs: 100,
      tokens: { input: 10, output: 5 },
      costUsd: 0.0003,
      status: "ok",
      promptHash: "h",
    };
    const ingest = await fetch(`${url}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer secret123" },
      body: JSON.stringify({ records: [fakeRec, fakeRec] }),
    });
    expect(ingest.status).toBe(200);
    expect(await ingest.json()).toEqual({ ok: true, ingested: 2 });

    const totalsRes = await fetch(`${url}/api/totals`);
    const totals = await totalsRes.json();
    expect(totals.total_calls).toBeGreaterThanOrEqual(2);
  });

  it("serves fallback HTML when no static dir", async () => {
    const r = await fetch(`${url}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const text = await r.text();
    expect(text).toContain("llmmeter is running");
  });
});
