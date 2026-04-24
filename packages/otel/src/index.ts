/**
 * OpenTelemetry sink for llmmeter.
 *
 * Emits Gen-AI semantic-convention spans (and optional metrics) for each
 * recorded LLM call, so they show up alongside the rest of your traces in
 * Jaeger, Tempo, Honeycomb, Datadog, New Relic, etc.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *
 * @example
 *   import { otelSink } from "llmmeter-otel";
 *   import { meter } from "@amit641/llmmeter";
 *   import { trace } from "@opentelemetry/api";
 *
 *   const sink = otelSink({ tracer: trace.getTracer("my-app") });
 *   const ai = meter(openai, { sink });
 */

import type { LLMCallRecord, Sink } from "llmmeter-core";
import {
  trace as traceApi,
  metrics as metricsApi,
  SpanStatusCode,
  SpanKind,
  type Tracer,
  type Meter,
  type Histogram,
  type Attributes,
} from "@opentelemetry/api";

const TRACER_NAME = "llmmeter";
const TRACER_VERSION = "0.1.0";

export interface OtelSinkOptions {
  /** Tracer to use. Defaults to global tracer "llmmeter". */
  tracer?: Tracer;
  /** Meter for histograms. Defaults to global meter "llmmeter". Pass `null` to disable metrics. */
  meter?: Meter | null;
  /** Span name builder. Default: `${operation} ${model}`. */
  spanName?: (record: LLMCallRecord) => string;
  /** Whether to attach prompt/completion as span events (default: true if record.prompt is present). */
  captureContent?: boolean;
  /** Friendly sink name for diagnostics. */
  name?: string;
}

export function otelSink(options: OtelSinkOptions = {}): Sink {
  const tracer = options.tracer ?? traceApi.getTracer(TRACER_NAME, TRACER_VERSION);

  let tokenHist: Histogram | null = null;
  let durationHist: Histogram | null = null;
  if (options.meter !== null) {
    const meterInst = options.meter ?? metricsApi.getMeter(TRACER_NAME, TRACER_VERSION);
    tokenHist = meterInst.createHistogram("gen_ai.client.token.usage", {
      description: "Measures number of input and output tokens used",
      unit: "{token}",
    });
    durationHist = meterInst.createHistogram("gen_ai.client.operation.duration", {
      description: "GenAI operation duration",
      unit: "s",
    });
  }

  return {
    name: options.name ?? "otel",
    write(record) {
      const startNs = record.ts * 1_000_000;
      const endNs = startNs + record.durationMs * 1_000_000;
      const span = tracer.startSpan(
        options.spanName?.(record) ?? `${record.operation} ${record.model}`,
        {
          kind: SpanKind.CLIENT,
          startTime: hrTime(startNs),
          attributes: spanAttributes(record),
        },
      );

      const captureContent = options.captureContent ?? record.prompt !== undefined;
      if (captureContent) {
        if (record.prompt !== undefined) {
          span.addEvent("gen_ai.user.message", { content: safeStringify(record.prompt) });
        }
        if (record.completion !== undefined) {
          span.addEvent("gen_ai.choice", { content: safeStringify(record.completion) });
        }
      }

      if (record.status === "error") {
        span.setStatus({ code: SpanStatusCode.ERROR, message: record.errorMessage });
        if (record.errorClass) span.recordException({ name: record.errorClass, message: record.errorMessage ?? "" });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end(hrTime(endNs));

      // Metrics
      const baseAttrs: Attributes = {
        "gen_ai.system": record.provider,
        "gen_ai.operation.name": opName(record.operation),
        "gen_ai.request.model": record.model,
      };
      if (tokenHist) {
        if (record.tokens.input) {
          tokenHist.record(record.tokens.input, { ...baseAttrs, "gen_ai.token.type": "input" });
        }
        if (record.tokens.output) {
          tokenHist.record(record.tokens.output, { ...baseAttrs, "gen_ai.token.type": "output" });
        }
      }
      if (durationHist) {
        durationHist.record(record.durationMs / 1000, baseAttrs);
      }
    },
    async flush() {
      // OTel SDK exporters flush via their own mechanisms. We're a thin emitter.
    },
    async close() {
      // Same as flush.
    },
  };
}

function spanAttributes(r: LLMCallRecord): Attributes {
  const a: Attributes = {
    "gen_ai.system": r.provider,
    "gen_ai.operation.name": opName(r.operation),
    "gen_ai.request.model": r.model,
    "gen_ai.usage.input_tokens": r.tokens.input,
    "gen_ai.usage.output_tokens": r.tokens.output,
    "llmmeter.cost_usd": r.costUsd ?? 0,
    "llmmeter.id": r.id,
    "llmmeter.trace_id": r.traceId,
    "llmmeter.prompt_hash": r.promptHash,
    "llmmeter.duration_ms": r.durationMs,
  };
  if (r.tokens.cachedInput !== undefined) a["gen_ai.usage.cached_input_tokens"] = r.tokens.cachedInput;
  if (r.tokens.reasoning !== undefined) a["gen_ai.usage.reasoning_tokens"] = r.tokens.reasoning;
  if (r.ttftMs !== undefined) a["llmmeter.ttft_ms"] = r.ttftMs;
  if (r.userId) a["enduser.id"] = r.userId;
  if (r.feature) a["llmmeter.feature"] = r.feature;
  if (r.conversationId) a["gen_ai.conversation.id"] = r.conversationId;
  if (r.errorClass) a["error.type"] = r.errorClass;
  if (r.meta) {
    for (const [k, v] of Object.entries(r.meta)) a[`llmmeter.meta.${k}`] = v as any;
  }
  return a;
}

function opName(op: string): string {
  // OTel uses snake_case names; "completion" stays as "text_completion" per spec.
  if (op === "completion") return "text_completion";
  return op;
}

function hrTime(ns: number): [number, number] {
  const seconds = Math.floor(ns / 1e9);
  const nanos = ns - seconds * 1e9;
  return [seconds, nanos];
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}
