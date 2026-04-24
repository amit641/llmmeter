import { describe, expect, it } from "vitest";
import { defaultRedact, hashPrompt } from "./redact.js";

describe("defaultRedact", () => {
  it("redacts emails inside strings", () => {
    expect(defaultRedact("contact me at user@example.com please")).toBe(
      "contact me at [REDACTED] please",
    );
  });

  it("walks nested objects and arrays", () => {
    const out = defaultRedact({
      messages: [{ role: "user", content: "key sk-abcdefghijklmnopqrstuvwxyz1234" }],
    }) as { messages: Array<{ content: string }> };
    expect(out.messages[0]!.content).toContain("[REDACTED]");
  });

  it("redacts JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(defaultRedact(`token=${jwt}`)).toBe("token=[REDACTED]");
  });

  it("returns primitives unchanged", () => {
    expect(defaultRedact(42)).toBe(42);
    expect(defaultRedact(null)).toBe(null);
    expect(defaultRedact(undefined)).toBe(undefined);
  });
});

describe("hashPrompt", () => {
  it("is stable for the same input", async () => {
    const a = await hashPrompt("hello");
    const b = await hashPrompt("hello");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differs for different inputs", async () => {
    const a = await hashPrompt({ a: 1 });
    const b = await hashPrompt({ a: 2 });
    expect(a).not.toBe(b);
  });
});
