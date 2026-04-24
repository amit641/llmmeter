---
title: Concepts
description: Core building blocks of llmmeter.
---

## Recorder

Every adapter (`llmmeter-openai`, `llmmeter-anthropic`, …) builds a `Recorder` from your `MeterOptions`. The recorder:

1. Generates a ULID for every call.
2. Pulls context out of `AsyncLocalStorage` (`userId`, `feature`, `traceId`, `meta`).
3. Hashes the prompt to `promptHash`.
4. Optionally redacts and stores the prompt + completion (off by default).
5. Calls `priceFor(...)` to compute USD cost from the bundled price table.
6. Enforces `maxDailySpendUsd`.
7. Hands the finalised `LLMCallRecord` to your `Sink`.

## Sinks

A sink is a thing that persists records. Sinks all implement `{ write, flush, close }`. Mix and match with `multiSink`:

```ts
import { meter, multiSink, jsonlSink } from "@amit641/llmmeter";
import { sqliteSink } from "@amit641/llmmeter/sqlite";
import { otelSink } from "llmmeter-otel";

const sink = multiSink(
  sqliteSink({ filePath: "./.llmmeter/llmmeter.db" }),
  otelSink({ tracer: trace.getTracer("my-app") }),
  jsonlSink({ dir: "./logs" }), // backup
);

const openai = meter(new OpenAI(), { sink });
```

## Context propagation

`withContext` uses Node's `AsyncLocalStorage` so context flows naturally through async boundaries — including framework code you don't control:

```ts
app.use(async (req, res, next) => {
  await withContext({ userId: req.user?.id, feature: req.path }, () => next());
});
```

Every LLM call made downstream inherits the context.

## Budget guards

```ts
meter(new OpenAI(), {
  maxDailySpendUsd: 100,
  onBudgetExceeded: "throw", // or "warn"
});
```

Spend is tracked per-process (in-memory) for now; for multi-instance deployments use the same sink across instances and run the cap check at the collector.

## Privacy

By default, llmmeter records `promptHash` (SHA-256), token counts, and metadata — never the raw prompt or response. Opt in per call with `recordPayload: true` and a `payloadSampleRate: 0.05` to capture 5% of payloads. The default redactor masks emails, credit cards, JWTs, and common API-key formats.

## Pricing

Prices live in [`packages/core/src/pricing.ts`](https://github.com/amit641/llmmeter/blob/main/packages/core/src/pricing.ts). They're versioned and updated weekly via a GitHub Action. To override:

```ts
import { PRICE_TABLE } from "@amit641/llmmeter";
PRICE_TABLE.push({ provider: "openai", model: "ft:my-model", inputPer1M: 3, outputPer1M: 12 });
```
