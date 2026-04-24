import { afterEach, describe, expect, it } from "vitest";
import { memorySink, shutdown } from "@llmmeter/core";
import { meter } from "./index.js";

afterEach(async () => {
  await shutdown();
});

describe("google adapter", () => {
  it("records generateContent", async () => {
    const sink = memorySink();
    const fakeModel = {
      model: "gemini-1.5-pro",
      async generateContent(_prompt: any) {
        return {
          response: {
            text: () => "Hello",
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
          },
        };
      },
    };
    const m = meter(fakeModel, { sink });
    const r = await m.generateContent("hi");
    expect(r.response.text()).toBe("Hello");
    await new Promise((r) => setTimeout(r, 5));
    const rec = sink.records[0]!;
    expect(rec.provider).toBe("google");
    expect(rec.model).toBe("gemini-1.5-pro");
    expect(rec.tokens.input).toBe(10);
    expect(rec.tokens.output).toBe(2);
    expect(rec.costUsd).toBeGreaterThan(0);
  });

  it("records generateContentStream and assembles completion", async () => {
    const sink = memorySink();
    const fakeModel = {
      model: "gemini-1.5-flash",
      async generateContentStream() {
        const chunks = [
          { text: () => "Hi " },
          { text: () => "there" },
        ];
        return {
          stream: (async function* () {
            for (const c of chunks) yield c;
          })(),
          response: Promise.resolve({
            text: () => "Hi there",
            usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
          }),
        };
      },
    };
    const m = meter(fakeModel, { sink, recordPayload: true });
    const result = await m.generateContentStream();
    let acc = "";
    for await (const chunk of result.stream) acc += chunk.text();
    await result.response;
    expect(acc).toBe("Hi there");
    await new Promise((r) => setTimeout(r, 5));
    const rec = sink.records[0]!;
    expect(rec.tokens.input).toBe(4);
    expect(rec.tokens.output).toBe(2);
    expect(rec.completion).toBe("Hi there");
    expect(rec.ttftMs).toBeTypeOf("number");
  });

  it("records embedContent (zero tokens)", async () => {
    const sink = memorySink();
    const fakeModel = {
      model: "text-embedding-004",
      async embedContent() {
        return { embedding: { values: [0.1, 0.2] } };
      },
    };
    const m = meter(fakeModel, { sink });
    await m.embedContent("hi");
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.operation).toBe("embedding");
  });

  it("captures errors", async () => {
    const sink = memorySink();
    const fakeModel = {
      model: "gemini-1.5-pro",
      async generateContent() {
        throw new Error("quota");
      },
    };
    const m = meter(fakeModel, { sink });
    await expect(m.generateContent("hi")).rejects.toThrow("quota");
    await new Promise((r) => setTimeout(r, 5));
    expect(sink.records[0]!.status).toBe("error");
  });
});
