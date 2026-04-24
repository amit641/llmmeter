# llmmeter

**Drop-in observability and cost tracking for any LLM SDK. One line of code.**

```ts
import OpenAI from "openai";
import { meter } from "llmmeter/openai";

const openai = meter(new OpenAI()); // <-- that's it
```

Then run `npx llmmeter dashboard` and open the URL it prints. You get:

- Real-time **spend in USD** by model, feature, user, and conversation
- **Token counts** (input, output, cached, reasoning) per call
- **Latency** with TTFT for streaming responses
- **Error rates** by class
- **Daily budget guards** that warn or throw before you blow the bank
- A local **dashboard** with filters, time-series, and a calls table

No agents, no proxies, no vendor lock-in. Calls are intercepted in-process, costs are computed locally from a versioned price table, and records are written to a sink you control.

---

## Install

```bash
npm i llmmeter
# or
pnpm add llmmeter
```

To wrap the OpenAI or Anthropic SDK, install one of:

```bash
pnpm add openai
pnpm add @anthropic-ai/sdk
```

---

## Quick starts

### 1. Local dev (default)

Records go to a SQLite file under `./.amit641/llmmeter.db`. Run the dashboard:

```bash
npx llmmeter dashboard
```

```ts
import OpenAI from "openai";
import { meter } from "llmmeter/openai";
import { sqliteSink } from "llmmeter/sqlite";

const openai = meter(new OpenAI(), {
  sink: sqliteSink(),                // optional: defaults to ./.amit641/llmmeter.db
  recordPayload: false,              // off by default for privacy
  maxDailySpendUsd: 50,
  onBudgetExceeded: "warn",          // or "throw"
});
```

### 2. Production: self-hosted collector

Put a small collector behind your apps; they POST batched records to it.

App side:

```ts
import { meter, httpSink } from "llmmeter";
import OpenAI from "openai";

const openai = meter(new OpenAI(), {
  sink: httpSink({
    url: process.env.LLMMETER_COLLECTOR_URL!, // https://meter.your-domain.com/ingest
    apiKey: process.env.LLMMETER_INGEST_TOKEN!,
  }),
  feature: "chat",
});
```

Collector (anywhere with persistent storage):

```bash
docker run -d \
  -e LLMMETER_DB_URL=postgres://user:pass@db/llmmeter \
  -e LLMMETER_INGEST_TOKEN=$(openssl rand -hex 32) \
  -e LLMMETER_DASHBOARD_TOKEN=$(openssl rand -hex 32) \
  -p 8080:8080 \
  ghcr.io/llmmeter/server:latest
```

Or run it from the CLI directly:

```bash
npx llmmeter serve \
  --pg postgres://user:pass@db/llmmeter \
  --port 8080 \
  --ingest-token $LLMMETER_INGEST_TOKEN \
  --dashboard-token $LLMMETER_DASHBOARD_TOKEN
```

### 3. Edge runtimes (Vercel Edge, Cloudflare Workers)

The HTTP sink is `fetch`-based and edge-compatible. Use it the same way as above; nothing else changes.

### 4. Hosted cloud — *coming soon*

We're building a managed collector + dashboard at [`llmmeter.dev/cloud`](https://llmmeter.dev/cloud) so you can skip the Docker step. Want early access? Open an issue or watch the repo.

---

## What gets recorded

Every call produces an `LLMCallRecord`:

```ts
{
  id: "01HF…",                       // ULID
  traceId: "01HF…",                  // groups multi-call ops (tool loops)
  ts: 1740000000000,
  provider: "openai",
  model: "gpt-4o-mini",
  operation: "chat",
  durationMs: 412,
  ttftMs: 120,                       // streaming
  tokens: { input: 1024, output: 233, cachedInput: 512, total: 1257 },
  costUsd: 0.000234,                 // looked up from the bundled price table
  status: "ok",
  userId: "u_42",                    // attached via withContext
  feature: "summarize",
  conversationId: "conv_999",
  promptHash: "9af…",                // SHA-256, always recorded
  prompt: undefined,                 // gated by recordPayload + sampling
  completion: undefined,             // ditto, redacted by default
}
```

### Attaching context

Use `withContext` once per request, and every metered call inside (including async work) inherits it:

```ts
import { withContext } from "llmmeter";

await withContext({ userId, feature: "chat", conversationId }, async () => {
  await openai.chat.completions.create(...);
  await openai.embeddings.create(...);
});
```

### Privacy

- `recordPayload: false` is the default; only token counts, cost, latency, and a SHA-256 prompt hash are stored.
- When you turn payloads on, a built-in regex redactor masks emails, credit cards, JWTs, and major API key patterns. Pass your own with `redact: (v) => …`.
- Use `payloadSampleRate: 0.1` to record 10% of payloads.

---

## Sinks

| Sink | Use when | Package |
| --- | --- | --- |
| `sqliteSink` | Local dev, single-instance prod | `llmmeter/sqlite` |
| `httpSink` | Multi-instance, edge, serverless | `llmmeter` |
| `postgresSink` | Self-hosted prod, multi-instance | `llmmeter/postgres` |
| `jsonlSink` | Cheap append-only log → ship later | `llmmeter` |
| `multiSink(a, b)` | Send to multiple destinations | `llmmeter` |
| `otelSink` | Use existing OTel pipeline (Jaeger / Tempo / Datadog / …) | `@llmmeter/otel` |
| **Cloud** | Managed hosted collector | *coming soon* |

Sinks are batched and durable: on `SIGTERM`/`SIGINT`/`beforeExit` we flush automatically. You can also call `await flushAll()` or `await shutdown()` manually (useful in serverless).

---

## CLI

```
llmmeter dashboard [--db PATH] [--port N] [--no-open]
llmmeter tail      [--db PATH] [--feature F] [--provider P] [--interval MS]
llmmeter analyze   [--db PATH] [--since 14d] [--min-cluster 5] [--include-untested]
llmmeter serve     --db PATH | --pg URL [--port N] [--ingest-token T] [--dashboard-token T]
llmmeter export    --db PATH --format jsonl|csv [--out FILE]
llmmeter prune     --db PATH --older-than 30d
llmmeter pricing   list [--provider X]
llmmeter version
```

`llmmeter tail` is `tail -f` for your LLM traffic. `llmmeter analyze` surfaces routing suggestions: features whose prompts could move to a model 1/15th the cost based on actual historical traffic.

---

## Adapters

| Provider | Package | Status |
| --- | --- | --- |
| OpenAI | `llmmeter/openai` | ✅ chat, embeddings, streaming, responses |
| Anthropic | `llmmeter/anthropic` | ✅ messages, streaming, prompt caching |
| Vercel AI SDK | `@llmmeter/vercel-ai` | ✅ generateText, streamText, embed, generateObject |
| Google Gemini | `@llmmeter/google` | ✅ generateContent, generateContentStream, embedContent |
| Mistral | `@llmmeter/mistral` | ✅ chat.complete, chat.stream, embeddings, fim |
| Generic `fetch` | `@llmmeter/fetch` | ✅ catch-all (OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter, DeepSeek, xAI, Ollama) |

The umbrella `meter()` auto-detects supported clients:

```ts
import { meter } from "llmmeter";
const openai    = meter(new OpenAI());
const anthropic = meter(new Anthropic());
```

---

## Architecture

```
┌────────────┐     LLMCallRecord      ┌─────────────┐
│ your code  │ ─────────────────────▶ │   sink      │
└────────────┘   (id, tokens, cost,   │ sqlite/http │
       │         latency, context)    │ postgres /… │
       │                              └──────┬──────┘
       │ wraps via Proxy                     │
       ▼                                     ▼
┌────────────┐                       ┌─────────────┐
│ OpenAI SDK │                       │  dashboard  │
│ Anthropic  │                       │  + queries  │
└────────────┘                       └─────────────┘
```

- **Adapters** wrap the SDK with a `Proxy`, so call sites stay untouched.
- **Recorder** generates a ULID, resolves `AsyncLocalStorage` context, samples + redacts payloads, computes cost via the price table, and pushes to the sink in a microtask (so your `await` is never blocked).
- **Sinks** batch and durably persist records. They're pluggable; bring your own.

---

## Repo layout

```
packages/
  core/        # @llmmeter/core — types, recorder, ALS, redaction, pricing, base sinks
  openai/      # @llmmeter/openai — OpenAI SDK adapter
  anthropic/   # @llmmeter/anthropic — Anthropic SDK adapter
  google/      # @llmmeter/google — Google Generative AI adapter
  mistral/     # @llmmeter/mistral — Mistral SDK adapter
  vercel-ai/   # @llmmeter/vercel-ai — Vercel AI SDK adapter
  fetch/       # @llmmeter/fetch — catch-all fetch() wrapper (auto-detects URL)
  sqlite/      # @llmmeter/sqlite — SQLite sink + read API
  postgres/    # @llmmeter/postgres — Postgres sink + read API
  otel/        # @llmmeter/otel — OpenTelemetry sink (Gen-AI semantic conventions)
  cli/         # @llmmeter/cli — `llmmeter` binary, dashboard server, collector, tail, analyze
  dashboard/   # @llmmeter/dashboard — React UI (bundled into cli/static)
  llmmeter/    # umbrella package — `import { meter } from "llmmeter"`
apps/
  docs/        # Astro Starlight docs site (publishes to llmmeter.dev)
examples/
  node-script/ # simulated 200-call demo, no API key needed
  next-app/    # Next.js wiring snippet
```

---

## License

MIT
