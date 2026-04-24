# @amit641/llmmeter-cli

The `llmmeter` binary. Bundles the dashboard UI and a zero-dep HTTP server.

```bash
# Local dashboard (reads ./.llmmeter/llmmeter.db)
npx @amit641/llmmeter-cli dashboard

# Production collector + dashboard
npx @amit641/llmmeter-cli serve --pg postgres://… --port 8080 \
  --ingest-token $LLMMETER_INGEST_TOKEN \
  --dashboard-token $LLMMETER_DASHBOARD_TOKEN

# Export
npx @amit641/llmmeter-cli export --format jsonl --out calls.jsonl

# Prune
npx @amit641/llmmeter-cli prune --older-than 30d

# Pricing table
npx @amit641/llmmeter-cli pricing list --provider openai
```

See the [main README](https://github.com/amit641/llmmeter) for full docs.
