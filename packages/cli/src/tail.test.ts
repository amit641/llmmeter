import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import type { LLMCallRecord } from "llmmeter-core";
import type { QueryFilters, Storage } from "./storage.js";
import { tail } from "./tail.js";

function bufferStream(): { stream: NodeJS.WritableStream; out: string[] } {
  const out: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      out.push(chunk.toString());
      cb();
    },
  });
  return { stream, out };
}

function rowsAsRecords(rs: LLMCallRecord[]): any[] {
  return rs.map((r) => ({
    ...r,
    input_tokens: r.tokens.input,
    output_tokens: r.tokens.output,
    duration_ms: r.durationMs,
    cost_usd: r.costUsd,
  }));
}

describe("tail", () => {
  it("prints only new rows on each poll", async () => {
    const initial: LLMCallRecord[] = [
      {
        id: "old",
        traceId: "t",
        ts: Date.now() - 10_000,
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "chat",
        durationMs: 100,
        tokens: { input: 5, output: 5 },
        costUsd: 0.0001,
        status: "ok",
        promptHash: "h",
      },
    ];
    let store = [...initial];
    const storage: Storage = {
      async totals() {
        return {};
      },
      async listCalls(f?: QueryFilters) {
        const ts = (r: LLMCallRecord) => r.ts;
        let s = store.slice();
        if (f?.fromTs != null) s = s.filter((r) => ts(r) >= f.fromTs!);
        s.sort((a, b) => b.ts - a.ts);
        return rowsAsRecords(s.slice(0, f?.limit ?? 100));
      },
      async aggregateByBucket() {
        return [];
      },
      async topByDimension() {
        return [];
      },
      async ingest() {},
      async pruneOlderThan() {
        return 0;
      },
      async close() {},
    };
    const { stream, out } = bufferStream();
    const stop = await tail({ storage, intervalMs: 30, out: stream });
    // Wait for header + initial poll (no new rows expected).
    await new Promise((r) => setTimeout(r, 80));
    const baseline = out.join("");
    expect(baseline).toContain("provider/model");
    // Add a new row newer than cursor.
    store.push({
      id: "new",
      traceId: "t2",
      ts: Date.now() + 100,
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      operation: "chat",
      durationMs: 200,
      tokens: { input: 10, output: 4 },
      costUsd: 0.0002,
      status: "ok",
      promptHash: "h2",
      feature: "rag",
    });
    await new Promise((r) => setTimeout(r, 100));
    stop();
    const all = out.join("");
    expect(all).toContain("anthropic/claude-3-5-sonnet");
    expect(all).toContain("rag");
  });
});
