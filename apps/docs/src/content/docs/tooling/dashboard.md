---
title: Dashboard
description: KPI tiles, time-series, and top-N breakdowns for your LLM traffic.
---

```sh
npx llmmeter dashboard
# → http://localhost:3737
```

The dashboard reads from your local SQLite (or remote Postgres if you point `serve` at one) and gives you:

- **KPIs**: total spend, calls, tokens, p95 latency, error rate.
- **Spend over time**: stacked area chart, bucketed by minute / hour / day.
- **Top by feature / model / user**: bar charts so you can spot the budget-eaters at a glance.
- **Recent calls table**: drill down by feature, model, status, time window. Click a row to see the prompt hash + raw payload (if recorded).

The same UI is bundled into the CLI via `llmmeter serve` and protected by the `--dashboard-token` you provide.
