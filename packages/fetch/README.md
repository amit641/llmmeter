# llmmeter-fetch

Catch-all `fetch()` wrapper for [llmmeter](https://github.com/amit641/llmmeter). Auto-detects requests to OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter, DeepSeek, xAI, and Ollama URLs and records them. Calls to anything else pass through untouched.

```ts
import { meterFetch } from "llmmeter-fetch";

// Globally:
globalThis.fetch = meterFetch(globalThis.fetch);

// Or scoped:
const fetch = meterFetch(globalThis.fetch, { feature: "rag" });
await fetch("https://api.openai.com/v1/chat/completions", { ... });
```

Supports both JSON responses and `text/event-stream` (SSE) streaming. The wrapper passes the original response through unchanged — your downstream code keeps streaming as normal while llmmeter records token counts and timing in the background.

For custom endpoints, pass a `parsers: [...]` array; see `FetchParser` in the source.
