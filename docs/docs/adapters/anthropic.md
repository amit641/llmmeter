---
title: Anthropic adapter
description: Drop-in observability for the official `@anthropic-ai/sdk`.
---

```ts
import Anthropic from "@anthropic-ai/sdk";
import { meter } from "@amit641/llmmeter/anthropic";

const anthropic = meter(new Anthropic());

const r = await anthropic.messages.create({
  model: "claude-3-5-sonnet-latest",
  max_tokens: 200,
  messages: [{ role: "user", content: "Hello!" }],
});
```

Wraps `messages.create` for both non-streaming and streaming calls. Parses Anthropic's typed event stream (`message_start`, `content_block_delta`, `message_delta`) to extract input, output, and `cache_read_input_tokens` (used for prompt caching).
