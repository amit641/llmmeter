import { afterEach, describe, expect, it } from "vitest";
import { meter, memorySink, shutdown } from "./index.js";

afterEach(async () => {
  await shutdown();
});

describe("umbrella meter() auto-detect", () => {
  it("dispatches to the openai adapter", async () => {
    const sink = memorySink();
    const fakeOpenAI = {
      chat: {
        completions: {
          async create(body: any) {
            return {
              model: body.model,
              choices: [{ message: { content: "hi" } }],
              usage: { prompt_tokens: 5, completion_tokens: 1 },
            };
          },
        },
      },
    };
    const c = meter(fakeOpenAI, { sink });
    await c.chat.completions.create({ model: "gpt-4o-mini", messages: [] });
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.provider).toBe("openai");
  });

  it("dispatches to the anthropic adapter", async () => {
    const sink = memorySink();
    const fakeAnthropic = {
      messages: {
        async create(body: any) {
          return {
            model: body.model,
            content: [{ type: "text", text: "hi" }],
            usage: { input_tokens: 5, output_tokens: 1 },
          };
        },
      },
    };
    const c = meter(fakeAnthropic, { sink });
    await c.messages.create({ model: "claude-3-5-sonnet", messages: [] });
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.provider).toBe("anthropic");
  });

  it("throws on unknown shape", () => {
    expect(() => meter({ foo() {} } as any, {})).toThrow(/auto-detect/);
  });
});
