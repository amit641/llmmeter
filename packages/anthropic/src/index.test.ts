import { afterEach, describe, expect, it } from "vitest";
import { memorySink, shutdown } from "@llmmeter/core";
import { meter } from "./index.js";

afterEach(async () => {
  await shutdown();
});

function fakeAnthropic() {
  return {
    messages: {
      async create(body: any) {
        if (body.stream) {
          return (async function* () {
            yield {
              type: "message_start",
              message: {
                model: body.model,
                usage: {
                  input_tokens: 10,
                  cache_read_input_tokens: 4,
                },
              },
            };
            yield { type: "content_block_start", content_block: { type: "text", text: "" } };
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } };
            yield { type: "content_block_delta", delta: { type: "text_delta", text: " there" } };
            yield { type: "content_block_stop" };
            yield {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
              usage: { output_tokens: 3 },
            };
            yield { type: "message_stop" };
          })();
        }
        return {
          id: "msg_fake",
          model: body.model,
          content: [{ type: "text", text: "Hi there" }],
          usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 4 },
        };
      },
    },
  };
}

describe("anthropic adapter", () => {
  it("records non-streaming messages.create", async () => {
    const sink = memorySink();
    const client = meter(fakeAnthropic(), { sink });
    const r = await client.messages.create({
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
    });
    expect(r.content[0].text).toBe("Hi there");
    await new Promise((r) => setTimeout(r, 5));
    const rec = sink.records[0]!;
    expect(rec.provider).toBe("anthropic");
    expect(rec.tokens.input).toBe(10);
    expect(rec.tokens.cachedInput).toBe(4);
    expect(rec.tokens.output).toBe(3);
    expect(rec.costUsd).toBeGreaterThan(0);
  });

  it("records streaming messages.create with TTFT", async () => {
    const sink = memorySink();
    const client = meter(fakeAnthropic(), { sink, recordPayload: true });
    const stream = await client.messages.create({
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
      stream: true,
    });
    let assembled = "";
    for await (const ev of stream as AsyncIterable<any>) {
      if (ev.type === "content_block_delta") assembled += ev.delta?.text ?? "";
    }
    expect(assembled).toBe("Hi there");
    await new Promise((r) => setTimeout(r, 5));
    const rec = sink.records[0]!;
    expect(rec.tokens.input).toBe(10);
    expect(rec.tokens.cachedInput).toBe(4);
    expect(rec.tokens.output).toBe(3);
    expect(rec.completion).toBe("Hi there");
    expect(rec.ttftMs).toBeTypeOf("number");
  });
});
