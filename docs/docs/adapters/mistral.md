---
title: Mistral adapter
description: Wrap `@mistralai/mistralai` v1+ clients.
---

```ts
import { Mistral } from "@mistralai/mistralai";
import { meter } from "llmmeter-mistral";

const client = meter(new Mistral({ apiKey: process.env.MISTRAL_API_KEY! }));

await client.chat.complete({
  model: "mistral-small-latest",
  messages: [{ role: "user", content: "Hello!" }],
});

for await (const event of await client.chat.stream({ ... })) {
  // streaming with TTFT + final usage captured automatically
}
```

Wraps `chat.complete`, `chat.stream`, `embeddings.create`, and the FIM endpoints (`fim.complete`, `fim.stream`).
