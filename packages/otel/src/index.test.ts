import { describe, expect, it } from "vitest";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import type { LLMCallRecord } from "llmmeter-core";
import { otelSink } from "./index.js";

function setup() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  trace.setGlobalTracerProvider(provider);
  return { exporter, provider };
}

const baseRecord = (): LLMCallRecord => ({
  id: "01HX",
  traceId: "T1",
  ts: Date.now() - 1000,
  provider: "openai",
  model: "gpt-4o-mini",
  operation: "chat",
  durationMs: 250,
  tokens: { input: 10, output: 5 },
  costUsd: 0.0001,
  status: "ok",
  promptHash: "abc",
});

describe("otelSink", () => {
  it("emits a span with Gen-AI semantic attributes", async () => {
    const { exporter, provider } = setup();
    const sink = otelSink({ tracer: provider.getTracer("t"), meter: null });
    sink.write(baseRecord());
    await sink.flush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.name).toBe("chat gpt-4o-mini");
    expect(span.attributes["gen_ai.system"]).toBe("openai");
    expect(span.attributes["gen_ai.operation.name"]).toBe("chat");
    expect(span.attributes["gen_ai.request.model"]).toBe("gpt-4o-mini");
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(10);
    expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(5);
    expect(span.attributes["llmmeter.cost_usd"]).toBe(0.0001);
    expect(span.status.code).toBe(1); // OK
  });

  it("marks errored calls as ERROR", async () => {
    const { exporter, provider } = setup();
    const sink = otelSink({ tracer: provider.getTracer("t2"), meter: null });
    sink.write({
      ...baseRecord(),
      status: "error",
      errorClass: "RateLimit",
      errorMessage: "429",
    });
    await sink.flush();
    const span = exporter.getFinishedSpans().find((s) => s.attributes["error.type"] === "RateLimit");
    expect(span?.status.code).toBe(2); // ERROR
    expect(span?.events.find((e) => e.name === "exception")).toBeTruthy();
  });

  it("emits prompt/completion as span events when content present", async () => {
    const { exporter, provider } = setup();
    const sink = otelSink({ tracer: provider.getTracer("t3"), meter: null });
    sink.write({ ...baseRecord(), prompt: "hello", completion: "hi back" });
    await sink.flush();
    const span = exporter.getFinishedSpans().pop()!;
    const events = span.events.map((e) => e.name);
    expect(events).toContain("gen_ai.user.message");
    expect(events).toContain("gen_ai.choice");
  });
});
