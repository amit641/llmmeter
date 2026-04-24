# @llmmeter/mistral

Mistral SDK adapter for [llmmeter](https://github.com/amit641/llmmeter). Works with `@mistralai/mistralai` v1+.

```ts
import { Mistral } from "@mistralai/mistralai";
import { meter } from "@llmmeter/mistral";

const client = meter(new Mistral({ apiKey: process.env.MISTRAL_API_KEY! }));
const r = await client.chat.complete({
  model: "mistral-small-latest",
  messages: [{ role: "user", content: "Hello" }],
});
```

Streaming via `chat.stream` and `fim.stream` is fully supported, including TTFT and assembled output.
