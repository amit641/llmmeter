---
title: Vercel AI SDK adapter
description: Wrap `generateText`, `streamText`, `embed`, etc. from the `ai` package.
---

```ts
import { generateText, streamText, embed } from "ai";
import { meter } from "llmmeter-vercel-ai";

const ai = meter({ generateText, streamText, embed });

const { text, usage } = await ai.generateText({
  model: openai("gpt-4o-mini"),
  prompt: "Hello!",
});

const result = ai.streamText({
  model: anthropic("claude-3-5-sonnet"),
  messages,
  onFinish: (r) => console.log(r.usage), // your handler still fires
});
```

llmmeter chains its hooks through `onFinish`, `onChunk`, and `onError`, so anything you supply still runs normally. Auto-detects the underlying provider from the model object's `.provider` string.
