import { afterEach, describe, expect, it } from "vitest";
import { memorySink, shutdown } from "llmmeter-core";
import { meter } from "./index.js";

afterEach(async () => {
  await shutdown();
});

describe("mistral adapter", () => {
  it("records chat.complete", async () => {
    const sink = memorySink();
    const fakeClient = {
      chat: {
        async complete(args: any) {
          return {
            id: "abc",
            model: args.model,
            choices: [{ message: { content: "Hello" } }],
            usage: { promptTokens: 6, completionTokens: 2, totalTokens: 8 },
          };
        },
      },
    };
    const c = meter(fakeClient, { sink });
    const r = await c.chat.complete({ model: "mistral-small-latest", messages: [{ role: "user", content: "hi" }] });
    expect(r.choices[0].message.content).toBe("Hello");
    await new Promise((r) => setTimeout(r, 5));
    const rec = sink.records[0]!;
    expect(rec.provider).toBe("mistral");
    expect(rec.model).toBe("mistral-small-latest");
    expect(rec.tokens.input).toBe(6);
    expect(rec.tokens.output).toBe(2);
    expect(rec.costUsd).toBeGreaterThan(0);
  });

  it("records embeddings.create", async () => {
    const sink = memorySink();
    const fakeClient = {
      embeddings: {
        async create(args: any) {
          return {
            id: "e",
            model: args.model,
            data: [{ embedding: [0.1, 0.2] }],
            usage: { promptTokens: 4, totalTokens: 4 },
          };
        },
      },
    };
    const c = meter(fakeClient, { sink });
    await c.embeddings.create({ model: "mistral-embed", inputs: ["hi"] });
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.operation).toBe("embedding");
    expect(sink.records[0]!.tokens.input).toBe(4);
  });

  it("records chat.stream and assembles deltas", async () => {
    const sink = memorySink();
    const fakeClient = {
      chat: {
        async *stream(args: any) {
          yield { data: { model: args.model, choices: [{ delta: { content: "Hi" } }] } };
          yield { data: { model: args.model, choices: [{ delta: { content: " there" } }] } };
          yield {
            data: {
              model: args.model,
              choices: [{ delta: {} }],
              usage: { promptTokens: 5, completionTokens: 2 },
            },
          };
        },
      },
    };
    const c = meter(fakeClient, { sink, recordPayload: true });
    const stream = await c.chat.stream({ model: "mistral-large-latest", messages: [] });
    let acc = "";
    for await (const event of stream) {
      acc += event.data.choices[0]?.delta?.content ?? "";
    }
    expect(acc).toBe("Hi there");
    await new Promise((r) => setTimeout(r, 5));
    const rec = sink.records[0]!;
    expect(rec.tokens.input).toBe(5);
    expect(rec.tokens.output).toBe(2);
    expect(rec.completion).toBe("Hi there");
    expect(rec.ttftMs).toBeTypeOf("number");
  });

  it("captures errors", async () => {
    const sink = memorySink();
    const fakeClient = {
      chat: {
        async complete() {
          throw new Error("rate limited");
        },
      },
    };
    const c = meter(fakeClient, { sink });
    await expect(c.chat.complete({ model: "mistral-small", messages: [] })).rejects.toThrow("rate limited");
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.status).toBe("error");
  });
});
