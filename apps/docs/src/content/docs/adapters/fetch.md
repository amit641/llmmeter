---
title: fetch (catch-all)
description: Instrument code you don't own by wrapping global `fetch()`.
---

```ts
import { meterFetch } from "@llmmeter/fetch";

globalThis.fetch = meterFetch(globalThis.fetch);

// Or scope per-call:
const fetch = meterFetch(globalThis.fetch, { feature: "rag" });
await fetch("https://api.openai.com/v1/chat/completions", { ... });
```

Auto-detects requests to:

- `api.openai.com` (and `api.deepseek.com` — same shape)
- `api.anthropic.com`
- `generativelanguage.googleapis.com` (Gemini)
- `api.mistral.ai`
- `api.groq.com`
- `openrouter.ai`
- `api.x.ai` (xAI / Grok)
- `localhost:11434/api/*` (Ollama)

Anything else passes through unchanged. Both JSON and `text/event-stream` SSE responses are supported, and TTFT is captured on the first chunk of a stream.

Use this when:

- You're using a custom HTTP client instead of an SDK.
- You want to instrument code you don't own.
- You're on Cloudflare Workers / Bun / Deno without a vendor SDK.

For custom endpoints, register a `FetchParser`:

```ts
import { meterFetch, type FetchParser } from "@llmmeter/fetch";

const myParser: FetchParser = {
  matches: (url) => url.hostname === "internal.api",
  detect: (url, body) => ({ provider: "custom", operation: "chat", model: "internal-llm" }),
  parseJson: (json) => ({ tokens: { input: json.in, output: json.out } }),
};

const fetch = meterFetch(globalThis.fetch, { parsers: [myParser] });
```
