---
title: OpenAI adapter
description: Drop-in observability for the official `openai` SDK.
---

```ts
import OpenAI from "openai";
import { meter } from "@amit641/llmmeter/openai";

const openai = meter(new OpenAI());

await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello!" }],
});
```

Wraps `chat.completions.create`, `responses.create`, and `embeddings.create`. Streaming is fully supported — llmmeter injects `stream_options: { include_usage: true }` so token counts arrive in the final chunk.

## Captured per call

- `tokens.input` / `tokens.output`
- `tokens.cachedInput` (from `prompt_tokens_details.cached_tokens`)
- `tokens.reasoning` (from `completion_tokens_details.reasoning_tokens` for `o1`/`o3` models)
- `ttftMs` for streamed responses
- Errors with class + status code

## Subpath imports

```ts
import { meter } from "@amit641/llmmeter/openai";        // explicit, smaller bundle
import { meter } from "@amit641/llmmeter";                // umbrella, auto-detects shape
```
