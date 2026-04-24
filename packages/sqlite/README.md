# llmmeter-sqlite

SQLite sink and read API for [llmmeter](https://github.com/amit641/llmmeter). Defaults to `./.llmmeter/llmmeter.db`. WAL mode, batched writes, full text indexes for the dashboard.

```ts
import { sqliteSink } from "llmmeter-sqlite"; // or "llmmeter/sqlite"

const sink = sqliteSink({ filePath: "./.llmmeter/llmmeter.db" });
```

Use with the dashboard CLI:

```bash
npx @amit641/llmmeter-cli dashboard --db ./.llmmeter/llmmeter.db
```
