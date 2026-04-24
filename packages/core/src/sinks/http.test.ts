import { describe, expect, it } from "vitest";
import { httpSink } from "./http.js";
import type { LLMCallRecord } from "../types.js";

const fakeRecord = (): LLMCallRecord => ({
  id: "01HF",
  traceId: "01HF",
  ts: Date.now(),
  provider: "openai",
  model: "gpt-4o-mini",
  operation: "chat",
  durationMs: 100,
  tokens: { input: 10, output: 5, total: 15 },
  costUsd: 0.0001,
  status: "ok",
  promptHash: "abc",
});

describe("httpSink", () => {
  it("batches and posts records", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const sink = httpSink({
      url: "https://example.test/ingest",
      batchSize: 3,
      flushIntervalMs: 10,
      fetch: async (url, init) => {
        calls.push({ url: url.toString(), body: JSON.parse((init?.body as string) ?? "{}") });
        return new Response("ok", { status: 200 });
      },
    });
    sink.write(fakeRecord());
    sink.write(fakeRecord());
    sink.write(fakeRecord());
    await sink.flush();
    expect(calls).toHaveLength(1);
    expect((calls[0]!.body as { records: unknown[] }).records).toHaveLength(3);
  });

  it("retries on 5xx and gives up gracefully", async () => {
    let attempts = 0;
    const sink = httpSink({
      url: "https://example.test/ingest",
      batchSize: 1,
      flushIntervalMs: 1,
      maxRetries: 2,
      fetch: async () => {
        attempts++;
        return new Response("nope", { status: 500 });
      },
    });
    sink.write(fakeRecord());
    await sink.flush();
    expect(attempts).toBe(3); // initial + 2 retries
  });

  it("does not retry on 4xx (except 429)", async () => {
    let attempts = 0;
    const sink = httpSink({
      url: "https://example.test/ingest",
      batchSize: 1,
      flushIntervalMs: 1,
      maxRetries: 5,
      fetch: async () => {
        attempts++;
        return new Response("bad", { status: 400 });
      },
    });
    sink.write(fakeRecord());
    await sink.flush();
    expect(attempts).toBe(1);
  });
});
