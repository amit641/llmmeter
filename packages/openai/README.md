# llmmeter-openai

OpenAI SDK adapter for [llmmeter](https://github.com/amit641/llmmeter). Wraps an `OpenAI` client with a `Proxy` so chat, embeddings, responses, and streaming calls are recorded transparently.

```ts
import OpenAI from "openai";
import { meter } from "llmmeter-openai";

const openai = meter(new OpenAI());
```

Or via the umbrella:

```ts
import { meter } from "@amit641/llmmeter/openai";
```
