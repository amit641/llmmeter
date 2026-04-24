# llmmeter-postgres

Postgres sink and read API for [llmmeter](https://github.com/amit641/llmmeter). For self-hosted, multi-instance production deployments. Auto-creates the schema on first write (disable with `skipSchemaInit: true` if you manage migrations).

```ts
import { postgresSink } from "llmmeter-postgres"; // or "llmmeter/postgres"

const sink = postgresSink({
  connectionString: process.env.DATABASE_URL!,
  batchSize: 100,
  flushIntervalMs: 1000,
});
```

Use with the collector + dashboard:

```bash
npx @amit641/llmmeter-cli serve --pg postgres://user:pass@db/llmmeter --port 8080
```
