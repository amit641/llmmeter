import { afterEach, describe, expect, it } from "vitest";
import { memorySink, shutdown, withContext } from "llmmeter-core";
import { meter } from "./index.js";

afterEach(async () => {
  await shutdown();
});

// Build a minimal fake "OpenAI client" that mirrors the surface llmmeter touches.
function fakeOpenAI() {
  return {
    chat: {
      completions: {
        async create(body: any) {
          if (body.stream) {
            return (async function* () {
              yield { model: body.model, choices: [{ delta: { content: "Hello" } }] };
              yield { model: body.model, choices: [{ delta: { content: " world" } }] };
              yield {
                model: body.model,
                choices: [{ delta: {}, finish_reason: "stop" }],
                usage: { prompt_tokens: 5, completion_tokens: 2 },
              };
            })();
          }
          return {
            id: "chatcmpl_fake",
            model: body.model,
            choices: [{ message: { role: "assistant", content: "Hello world" } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              prompt_tokens_details: { cached_tokens: 4 },
            },
          };
        },
      },
    },
    embeddings: {
      async create(body: any) {
        return {
          model: body.model,
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 7 },
        };
      },
    },
  };
}

describe("openai adapter", () => {
  it("records a non-streaming chat call", async () => {
    const sink = memorySink();
    const client = meter(fakeOpenAI(), { sink });
    const r = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.choices[0].message.content).toBe("Hello world");
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records).toHaveLength(1);
    const rec = sink.records[0]!;
    expect(rec.provider).toBe("openai");
    expect(rec.model).toBe("gpt-4o-mini");
    expect(rec.operation).toBe("chat");
    expect(rec.tokens.input).toBe(10);
    expect(rec.tokens.output).toBe(5);
    expect(rec.tokens.cachedInput).toBe(4);
    expect(rec.costUsd).toBeGreaterThan(0);
    expect(rec.status).toBe("ok");
  });

  it("records a streaming chat call with TTFT and final usage", async () => {
    const sink = memorySink();
    const client = meter(fakeOpenAI(), { sink });
    const stream = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    let assembled = "";
    for await (const chunk of stream as AsyncIterable<any>) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (delta) assembled += delta;
    }
    expect(assembled).toBe("Hello world");
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records).toHaveLength(1);
    const rec = sink.records[0]!;
    expect(rec.tokens.input).toBe(5);
    expect(rec.tokens.output).toBe(2);
    expect(rec.ttftMs).toBeTypeOf("number");
    expect(rec.completion).toBeUndefined(); // recordPayload defaults to false
  });

  it("stores assembled stream completion when recordPayload=true", async () => {
    const sink = memorySink();
    const client = meter(fakeOpenAI(), { sink, recordPayload: true });
    const stream = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    for await (const _ of stream as AsyncIterable<any>) {
      // drain
    }
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.completion).toBe("Hello world");
  });

  it("does not store payloads by default", async () => {
    const sink = memorySink();
    const client = meter(fakeOpenAI(), { sink });
    await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "secret" }],
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.prompt).toBeUndefined();
    expect(sink.records[0]!.completion).toBeUndefined();
  });

  it("stores payloads when enabled", async () => {
    const sink = memorySink();
    const client = meter(fakeOpenAI(), { sink, recordPayload: true });
    await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }],
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.prompt).toBeDefined();
    expect(sink.records[0]!.completion).toBe("Hello world");
  });

  it("records embeddings", async () => {
    const sink = memorySink();
    const client = meter(fakeOpenAI(), { sink });
    await client.embeddings.create({
      model: "text-embedding-3-small",
      input: "hello world",
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.operation).toBe("embedding");
    expect(sink.records[0]!.tokens.input).toBe(7);
  });

  it("propagates AsyncLocalStorage context", async () => {
    const sink = memorySink();
    const client = meter(fakeOpenAI(), { sink });
    await withContext({ userId: "u_99", feature: "summarize" }, async () => {
      await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      });
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.userId).toBe("u_99");
    expect(sink.records[0]!.feature).toBe("summarize");
  });

  it("captures errors without swallowing them", async () => {
    const sink = memorySink();
    const broken = {
      chat: {
        completions: {
          async create() {
            const err = new Error("rate limited");
            err.name = "RateLimitError";
            throw err;
          },
        },
      },
    };
    const client = meter(broken, { sink });
    await expect(
      client.chat.completions.create({ model: "gpt-4o-mini", messages: [] }),
    ).rejects.toThrow("rate limited");
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.status).toBe("error");
    expect(sink.records[0]!.errorClass).toBe("RateLimitError");
  });
});
