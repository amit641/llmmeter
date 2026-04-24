---
title: HTTP sink (edge)
description: Batched, retried POSTs to a remote collector. Designed for Lambda / Workers / Vercel.
---

```ts
import { httpSink } from "@amit641/llmmeter";

const sink = httpSink({
  url: "https://collector.mycompany.com/ingest",
  token: process.env.LLMMETER_INGEST_TOKEN,
  batchSize: 25,
  flushIntervalMs: 1000,
});
```

The HTTP sink batches records, gzip-compresses them, and POSTs to your collector with bounded retries (exponential backoff on `5xx` and `429`). It has a bounded in-memory buffer and drops oldest on overflow rather than crashing your process.

Designed for ephemeral compute environments (Lambda, Cloudflare Workers, Vercel Edge) where you can't keep a SQLite file alive between invocations. Pair with `llmmeter serve` running on a long-lived box, or with the upcoming hosted cloud service.
