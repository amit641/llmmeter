---
title: Self-hosted Docker
description: Run the llmmeter collector + dashboard in production with one container.
---

```sh
docker run -d --name llmmeter \
  -p 8080:8080 \
  -e LLMMETER_DB_URL=postgres://user:pass@db/llmmeter \
  -e LLMMETER_INGEST_TOKEN=$(openssl rand -hex 32) \
  -e LLMMETER_DASHBOARD_TOKEN=$(openssl rand -hex 32) \
  ghcr.io/amit641/llmmeter:latest
```

The image runs `llmmeter serve`, which exposes:

- `POST /ingest` — accepts batched `LLMCallRecord[]` (Bearer token required)
- `/api/*` — read API for the dashboard (token-protected)
- `/` — the embedded React dashboard (token-protected)

## Wire your app to the collector

```ts
import { meter, httpSink } from "@amit641/llmmeter";

const sink = httpSink({
  url: "https://llmmeter.mycompany.com/ingest",
  token: process.env.LLMMETER_INGEST_TOKEN,
});
const openai = meter(new OpenAI(), { sink });
```

## Storage

- **SQLite** (default): a single Docker volume is enough for tens of millions of records.
- **Postgres** (`LLMMETER_DB_URL`): for multi-instance deployments or when you already have managed Postgres.

## Pruning

Schedule a cron:

```sh
docker exec llmmeter llmmeter prune --pg "$LLMMETER_DB_URL" --older-than 90d
```
