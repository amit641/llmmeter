# llmmeter-vercel-ai

Vercel AI SDK adapter for [llmmeter](https://github.com/amit641/llmmeter). Wraps `generateText`, `streamText`, `generateObject`, `streamObject`, `embed`, and `embedMany`.

```ts
import { generateText, streamText, embed } from "ai";
import { meter } from "llmmeter-vercel-ai";

const ai = meter({ generateText, streamText, embed });

const { text, usage } = await ai.generateText({
  model: openai("gpt-4o-mini"),
  prompt: "Hello",
});
```

For streaming, llmmeter chains its hook through `onFinish`/`onChunk`/`onError`, so any handlers you supply still fire normally.
