# @llmmeter/otel

OpenTelemetry sink for [llmmeter](https://github.com/amit641/llmmeter). Emits [Gen-AI semantic-convention](https://opentelemetry.io/docs/specs/semconv/gen-ai/) spans + metrics for every recorded LLM call, so they show up alongside the rest of your traces in Jaeger, Tempo, Honeycomb, Datadog, New Relic — anything that speaks OTLP.

```ts
import { meter, multiSink, sqliteSink } from "llmmeter";
import { otelSink } from "@llmmeter/otel";
import { trace } from "@opentelemetry/api";

const ai = meter(openai, {
  sink: multiSink(
    sqliteSink({ filePath: "./.amit641/llmmeter.db" }),
    otelSink({ tracer: trace.getTracer("my-app") }),
  ),
});
```

Set up the OTel SDK as you normally would (`@opentelemetry/sdk-node` + an OTLP exporter); this sink just adds Gen-AI spans on top.

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

Plus metrics: `gen_ai.client.token.usage` and `gen_ai.client.operation.duration` histograms.
