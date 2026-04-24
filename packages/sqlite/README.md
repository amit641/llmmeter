# @llmmeter/sqlite

SQLite sink and read API for [llmmeter](https://github.com/amit641/llmmeter). Defaults to `./.amit641/llmmeter.db`. WAL mode, batched writes, full text indexes for the dashboard.

```ts
import { sqliteSink } from "@llmmeter/sqlite"; // or "llmmeter/sqlite"

const sink = sqliteSink({ filePath: "./.amit641/llmmeter.db" });
```

Use with the dashboard CLI:

```bash
npx llmmeter dashboard --db ./.amit641/llmmeter.db
```
