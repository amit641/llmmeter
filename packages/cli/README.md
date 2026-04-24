# @llmmeter/cli

The `llmmeter` binary. Bundles the dashboard UI and a zero-dep HTTP server.

```bash
# Local dashboard (reads ./.amit641/llmmeter.db)
npx llmmeter dashboard

# Production collector + dashboard
npx llmmeter serve --pg postgres://… --port 8080 \
  --ingest-token $LLMMETER_INGEST_TOKEN \
  --dashboard-token $LLMMETER_DASHBOARD_TOKEN

# Export
npx llmmeter export --format jsonl --out calls.jsonl

# Prune
npx llmmeter prune --older-than 30d

# Pricing table
npx llmmeter pricing list --provider openai
```

See the [main README](https://github.com/amit641/llmmeter) for full docs.
