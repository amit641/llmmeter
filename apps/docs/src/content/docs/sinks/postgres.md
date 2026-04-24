---
title: Postgres sink (production)
description: Persistent storage for self-hosted, multi-instance production.
---

```ts
import { postgresSink } from "@llmmeter/postgres";

const sink = postgresSink({
  connectionString: process.env.LLMMETER_DB_URL,
  batchSize: 50,
  flushIntervalMs: 1000,
});
```

The Postgres sink uses the `pg` connection pool. On first write it bootstraps the `llmmeter_calls` table with appropriate indices (override with `skipSchemaInit: true` if you manage migrations).

Read API mirrors the SQLite read API exactly so the dashboard works without code changes:

- `listCalls(pool, filters)`
- `aggregateByBucket(pool, bucketSeconds, filters)`
- `topByDimension(pool, dim, filters)`
- `totals(pool, filters)`
- `pruneOlderThan(pool, beforeTs)`

Use this for any deployment where multiple processes need to write to the same store, or where you want to retain millions of records.
