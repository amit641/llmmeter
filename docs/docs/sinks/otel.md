---
title: OpenTelemetry sink
description: Emit Gen-AI semantic-convention spans to your existing OTel pipeline.
---

```ts
import { meter, multiSink } from "@amit641/llmmeter";
import { sqliteSink } from "@amit641/llmmeter/sqlite";
import { otelSink } from "llmmeter-otel";
import { trace } from "@opentelemetry/api";

const ai = meter(openai, {
  sink: multiSink(
    sqliteSink({ filePath: "./.llmmeter/llmmeter.db" }),
    otelSink({ tracer: trace.getTracer("my-app") }),
  ),
});
```

Emits spans with [Gen-AI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) so your existing Jaeger / Tempo / Honeycomb / Datadog backend gets them automatically.

## Span attributes

| Attribute | Source |
| --- | --- |
| `gen_ai.system` | `record.provider` |
| `gen_ai.operation.name` | `record.operation` |
| `gen_ai.request.model` | `record.model` |
| `gen_ai.usage.input_tokens` | `record.tokens.input` |
| `gen_ai.usage.output_tokens` | `record.tokens.output` |
| `gen_ai.usage.cached_input_tokens` | `record.tokens.cachedInput` (if present) |
| `gen_ai.conversation.id` | `record.conversationId` |
| `enduser.id` | `record.userId` |
| `llmmeter.cost_usd` | `record.costUsd` |
| `llmmeter.feature` | `record.feature` |
| `llmmeter.ttft_ms` | `record.ttftMs` |

Plus two histograms: `gen_ai.client.token.usage` and `gen_ai.client.operation.duration`.
