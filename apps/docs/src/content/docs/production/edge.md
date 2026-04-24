---
title: Edge runtimes
description: Lambda, Cloudflare Workers, Vercel Edge.
---

Edge environments are stateless: you can't keep a SQLite file alive between invocations. Use the HTTP sink to ship to a long-lived collector:

```ts
import { meter, httpSink } from "llmmeter";

const openai = meter(new OpenAI(), {
  sink: httpSink({
    url: process.env.LLMMETER_COLLECTOR_URL!,
    token: process.env.LLMMETER_INGEST_TOKEN,
    batchSize: 10,
    flushIntervalMs: 200, // flush more eagerly on edge
  }),
});

// Vercel Edge / Cloudflare Workers: ensure the request waits for the flush.
ctx.waitUntil(shutdown());
```

For Cloudflare Workers without a Node runtime, use the [`@llmmeter/fetch`](/adapters/fetch/) adapter instead — it works on web fetch with no Node dependencies.
