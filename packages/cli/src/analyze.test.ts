import { describe, expect, it } from "vitest";
import type { Storage } from "./storage.js";
import { analyzeRouting, suggestUntestedAlternatives } from "./analyze.js";

function makeStorage(rows: any[]): Storage {
  return {
    async totals() {
      return {};
    },
    async listCalls() {
      return rows;
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
}

const now = Date.now();

describe("analyzeRouting", () => {
  it("flags features whose prompts succeed at a cheaper model", async () => {
    const rows: any[] = [];
    // 10 calls of /support to gpt-4o (expensive)
    for (let i = 0; i < 10; i++) {
      rows.push({
        feature: "support",
        provider: "openai",
        model: "gpt-4o",
        prompt_hash: "p1",
        input_tokens: 1000,
        output_tokens: 500,
        cost_usd: 0.01,
        status: "ok",
        ts: now,
      });
    }
    // 5 calls of the SAME prompt to gpt-4o-mini (cheap), all succeeded
    for (let i = 0; i < 5; i++) {
      rows.push({
        feature: "support",
        provider: "openai",
        model: "gpt-4o-mini",
        prompt_hash: "p1",
        input_tokens: 1000,
        output_tokens: 500,
        cost_usd: 0.0005,
        status: "ok",
        ts: now,
      });
    }
    const suggestions = await analyzeRouting({ storage: makeStorage(rows) });
    expect(suggestions.length).toBeGreaterThan(0);
    const top = suggestions[0]!;
    expect(top.feature).toBe("support");
    expect(top.fromModel).toBe("gpt-4o");
    expect(top.toModel).toBe("gpt-4o-mini");
    expect(top.savedUsd).toBeGreaterThan(0);
    expect(top.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("does not suggest if the cheaper model has high error rate", async () => {
    const rows: any[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push({
        feature: "support",
        provider: "openai",
        model: "gpt-4o",
        prompt_hash: "p2",
        input_tokens: 1000,
        output_tokens: 500,
        cost_usd: 0.01,
        status: "ok",
        ts: now,
      });
    }
    for (let i = 0; i < 5; i++) {
      rows.push({
        feature: "support",
        provider: "openai",
        model: "gpt-4o-mini",
        prompt_hash: "p2",
        input_tokens: 1000,
        output_tokens: 500,
        cost_usd: 0.0005,
        status: "error", // candidate fails
        ts: now,
      });
    }
    const suggestions = await analyzeRouting({ storage: makeStorage(rows), minConfidence: 0.95 });
    expect(suggestions.find((s) => s.fromModel === "gpt-4o")).toBeUndefined();
  });
});

describe("suggestUntestedAlternatives", () => {
  it("recommends a same-provider cheaper model from the price table", async () => {
    const rows: any[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push({
        feature: "rag",
        provider: "openai",
        model: "gpt-4o",
        prompt_hash: `p${i}`,
        input_tokens: 800,
        output_tokens: 200,
        cost_usd: 0.005,
        status: "ok",
        ts: now,
      });
    }
    const recs = await suggestUntestedAlternatives({ storage: makeStorage(rows) });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.fromModel).toBe("gpt-4o");
    expect(recs[0]!.estimatedSavedUsd).toBeGreaterThan(0);
  });
});
