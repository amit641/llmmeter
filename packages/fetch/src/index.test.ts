import { afterEach, describe, expect, it } from "vitest";
import { memorySink, shutdown } from "@llmmeter/core";
import { meterFetch } from "./index.js";

afterEach(async () => {
  await shutdown();
});

const ENC = new TextEncoder();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function sseResponse(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(ENC.encode(e + "\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("meterFetch", () => {
  it("records OpenAI chat (non-streaming)", async () => {
    const sink = memorySink();
    const fakeFetch = async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        model: "gpt-4o-mini",
        choices: [{ message: { content: "hi" } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      });
    const f = meterFetch(fakeFetch as typeof fetch, { sink });
    const r = await f("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
    });
    const j = await r.json();
    expect(j.choices[0].message.content).toBe("hi");
    await new Promise((r) => setTimeout(r, 5));
    const rec = sink.records[0]!;
    expect(rec.provider).toBe("openai");
    expect(rec.tokens.input).toBe(7);
    expect(rec.tokens.output).toBe(3);
    expect(rec.costUsd).toBeGreaterThan(0);
  });

  it("records Anthropic messages (non-streaming)", async () => {
    const sink = memorySink();
    const fakeFetch = async () =>
      jsonResponse({
        model: "claude-3-5-sonnet",
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 9, output_tokens: 2, cache_read_input_tokens: 5 },
      });
    const f = meterFetch(fakeFetch as typeof fetch, { sink });
    await f("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "claude-3-5-sonnet", messages: [], max_tokens: 100 }),
    });
    await new Promise((r) => setTimeout(r, 5));
    const rec = sink.records[0]!;
    expect(rec.provider).toBe("anthropic");
    expect(rec.tokens.cachedInput).toBe(5);
  });

  it("records Google generateContent", async () => {
    const sink = memorySink();
    const fakeFetch = async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "hi" }] } }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 1 },
      });
    const f = meterFetch(fakeFetch as typeof fetch, { sink });
    await f("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent", {
      method: "POST",
      body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] }),
    });
    await new Promise((r) => setTimeout(r, 5));
    const rec = sink.records[0]!;
    expect(rec.provider).toBe("google");
    expect(rec.model).toBe("gemini-1.5-pro");
    expect(rec.tokens.input).toBe(11);
  });

  it("passes through unknown URLs untouched", async () => {
    const sink = memorySink();
    const fakeFetch = async () => new Response("ok");
    const f = meterFetch(fakeFetch as typeof fetch, { sink });
    const r = await f("https://example.com/some/random/url");
    expect(await r.text()).toBe("ok");
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records).toHaveLength(0);
  });

  it("records HTTP error responses", async () => {
    const sink = memorySink();
    const fakeFetch = async () => new Response("rate limited", { status: 429, headers: { "content-type": "application/json" } });
    const f = meterFetch(fakeFetch as typeof fetch, { sink });
    await f("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }),
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.status).toBe("error");
    expect(sink.records[0]!.errorClass).toBe("HTTP 429");
  });

  it("records OpenAI streaming response with TTFT and final usage", async () => {
    const sink = memorySink();
    const fakeFetch = async () =>
      sseResponse([
        `data: ${JSON.stringify({ model: "gpt-4o-mini", choices: [{ delta: { content: "Hi" } }] })}`,
        `data: ${JSON.stringify({ model: "gpt-4o-mini", choices: [{ delta: { content: " there" } }] })}`,
        `data: ${JSON.stringify({
          model: "gpt-4o-mini",
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        })}`,
        `data: [DONE]`,
      ]);
    const f = meterFetch(fakeFetch as typeof fetch, { sink, recordPayload: true });
    const r = await f("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-4o-mini", stream: true, messages: [] }),
    });
    // Drain the stream like a normal consumer would
    const reader = r.body!.getReader();
    let received = "";
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += dec.decode(value);
    }
    // Raw SSE body is passed through unchanged: each delta is its own data event
    expect(received).toContain('"content":"Hi"');
    expect(received).toContain('"content":" there"');
    expect(received).toContain("[DONE]");
    await new Promise((r) => setTimeout(r, 10));
    const rec = sink.records[0]!;
    expect(rec.provider).toBe("openai");
    expect(rec.tokens.input).toBe(5);
    expect(rec.tokens.output).toBe(2);
    // The recorder assembles the deltas into the final completion
    expect(rec.completion).toBe("Hi there");
    expect(rec.ttftMs).toBeTypeOf("number");
  });
});
