import { afterEach, describe, expect, it } from "vitest";
import { memorySink, shutdown } from "llmmeter-core";
import { meter } from "./index.js";

afterEach(async () => {
  await shutdown();
});

const fakeModel = (provider: string, modelId: string) => ({ provider, modelId });

describe("vercel-ai adapter", () => {
  it("records generateText usage", async () => {
    const sink = memorySink();
    const generateText = async (params: any) => ({
      text: "hello",
      usage: { promptTokens: 8, completionTokens: 3, totalTokens: 11 },
      response: { modelId: params.model.modelId },
    });
    const ai = meter({ generateText }, { sink });
    const r = await ai.generateText!({ model: fakeModel("openai.chat", "gpt-4o-mini"), prompt: "hi" });
    expect(r.text).toBe("hello");
    await new Promise((r) => setTimeout(r, 5));
    const rec = sink.records[0]!;
    expect(rec.provider).toBe("openai");
    expect(rec.model).toBe("gpt-4o-mini");
    expect(rec.tokens.input).toBe(8);
    expect(rec.tokens.output).toBe(3);
    expect(rec.costUsd).toBeGreaterThan(0);
  });

  it("records embed usage", async () => {
    const sink = memorySink();
    const embed = async () => ({
      embedding: [0.1, 0.2],
      usage: { tokens: 12 },
    });
    const ai = meter({ embed }, { sink });
    await ai.embed!({ model: fakeModel("openai.embedding", "text-embedding-3-small"), value: "hi" });
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.operation).toBe("embedding");
    expect(sink.records[0]!.tokens.input).toBe(12);
  });

  it("records streamText via onFinish hook", async () => {
    const sink = memorySink();
    let userOnFinishCalled = false;
    const streamText = (params: any) => {
      // Simulate the SDK calling onChunk then onFinish.
      setTimeout(() => params.onChunk?.({ type: "text-delta", textDelta: "Hi" }), 1);
      setTimeout(() => {
        params.onFinish?.({
          text: "Hi there",
          usage: { promptTokens: 4, completionTokens: 2 },
          response: { modelId: params.model.modelId },
        });
      }, 5);
      return { textStream: (async function* () { yield "Hi there"; })() };
    };
    const ai = meter(
      { streamText },
      { sink, recordPayload: true },
    );
    ai.streamText!({
      model: fakeModel("anthropic.messages", "claude-3-5-sonnet"),
      prompt: "hi",
      onFinish: () => {
        userOnFinishCalled = true;
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(userOnFinishCalled).toBe(true);
    const rec = sink.records[0]!;
    expect(rec.provider).toBe("anthropic");
    expect(rec.tokens.input).toBe(4);
    expect(rec.tokens.output).toBe(2);
    expect(rec.completion).toBe("Hi there");
    expect(rec.ttftMs).toBeTypeOf("number");
  });

  it("captures errors", async () => {
    const sink = memorySink();
    const generateText = async () => {
      const e = new Error("API down");
      e.name = "APIError";
      throw e;
    };
    const ai = meter({ generateText }, { sink });
    await expect(
      ai.generateText!({ model: fakeModel("openai.chat", "gpt-4o-mini"), prompt: "hi" }),
    ).rejects.toThrow("API down");
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.status).toBe("error");
    expect(sink.records[0]!.errorClass).toBe("APIError");
  });
});
