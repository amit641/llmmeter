import { afterEach, describe, expect, it } from "vitest";
import { buildRecorder, shutdown } from "./meter.js";
import { memorySink } from "./sinks/memory.js";
import { withContext } from "./context.js";

afterEach(async () => {
  await shutdown();
});

describe("Recorder", () => {
  it("records a successful call with cost", async () => {
    const sink = memorySink();
    const rec = buildRecorder({ sink });
    const start = rec.start({ prompt: { messages: [{ role: "user", content: "hi" }] } });
    await new Promise((r) => setTimeout(r, 5));
    await rec.finish(start, {
      provider: "openai",
      model: "gpt-4o-mini",
      operation: "chat",
      tokens: { input: 100, output: 50 },
      completion: "hello",
    });
    await new Promise((r) => setTimeout(r, 0)); // let microtask flush
    expect(sink.records).toHaveLength(1);
    const r = sink.records[0]!;
    expect(r.status).toBe("ok");
    expect(r.provider).toBe("openai");
    expect(r.model).toBe("gpt-4o-mini");
    expect(r.tokens.input).toBe(100);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.promptHash).toHaveLength(64);
    expect(r.prompt).toBeUndefined(); // recordPayload defaults to false
  });

  it("attaches AsyncLocalStorage context", async () => {
    const sink = memorySink();
    const rec = buildRecorder({ sink });

    await withContext({ userId: "u_42", feature: "chat" }, async () => {
      const s = rec.start({ prompt: "x" });
      await rec.finish(s, {
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "chat",
        tokens: { input: 5, output: 5 },
      });
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sink.records[0]!.userId).toBe("u_42");
    expect(sink.records[0]!.feature).toBe("chat");
  });

  it("records payload when recordPayload=true", async () => {
    const sink = memorySink();
    const rec = buildRecorder({ sink, recordPayload: true });
    const s = rec.start({ prompt: "the email is foo@bar.com" });
    await rec.finish(s, {
      provider: "openai",
      model: "gpt-4o-mini",
      operation: "chat",
      tokens: { input: 5, output: 5 },
      completion: "ok",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sink.records[0]!.prompt).toBe("the email is [REDACTED]");
  });

  it("records errors", async () => {
    const sink = memorySink();
    const rec = buildRecorder({ sink });
    const s = rec.start({ prompt: "x" });
    await rec.fail(s, {
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      operation: "chat",
      errorClass: "RateLimitError",
      errorMessage: "429",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sink.records[0]!.status).toBe("error");
    expect(sink.records[0]!.errorClass).toBe("RateLimitError");
  });
});
