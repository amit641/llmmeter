import { describe, expect, it } from "vitest";
import { priceFor } from "./pricing.js";

describe("priceFor", () => {
  it("computes cost for a known model", () => {
    const cost = priceFor("openai", "gpt-4o-mini", { input: 1000, output: 500 });
    // 1000 * 0.15 / 1M + 500 * 0.6 / 1M = 0.00015 + 0.0003 = 0.00045
    expect(cost).toBeCloseTo(0.00045, 6);
  });

  it("strips date suffix to match base model", () => {
    const cost = priceFor("openai", "gpt-4o-2024-08-06", { input: 1000, output: 1000 });
    expect(cost).toBeCloseTo(0.0125, 6);
  });

  it("returns null for unknown model", () => {
    expect(priceFor("openai", "totally-made-up", { input: 100, output: 100 })).toBeNull();
  });

  it("supports cached input pricing", () => {
    const cost = priceFor("anthropic", "claude-3-5-sonnet", {
      input: 10_000,
      cachedInput: 8_000,
      output: 1_000,
    });
    // fresh = 2000 * 3 / 1M = 0.006
    // cached = 8000 * 0.3 / 1M = 0.0024
    // out = 1000 * 15 / 1M = 0.015
    // total = 0.0234
    expect(cost).toBeCloseTo(0.0234, 6);
  });

  it("treats Ollama as free via wildcard", () => {
    expect(priceFor("ollama", "llama3.3", { input: 1_000_000, output: 500_000 })).toBe(0);
  });
});
