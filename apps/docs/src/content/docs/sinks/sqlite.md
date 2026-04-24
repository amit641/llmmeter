---
title: SQLite sink (local)
description: Durable local storage with the dashboard read API.
---

```ts
import { sqliteSink } from "@amit641/llmmeter/sqlite";
const sink = sqliteSink({ filePath: "./.llmmeter/llmmeter.db" });
```

Backed by `better-sqlite3` with WAL mode for concurrent reads. The sink batches writes (default 50 records or 500 ms, whichever comes first) and flushes on `process.exit`.

Comes with the read API used by the dashboard:

- `listCalls(db, filters)`
- `aggregateByBucket(db, bucketSeconds, filters)`
- `topByDimension(db, "feature" | "model" | …, filters)`
- `totals(db, filters)`
- `pruneOlderThan(db, beforeTs)`

Single-instance production deployments (one container, one disk) often run perfectly fine on SQLite for thousands of calls per second.
