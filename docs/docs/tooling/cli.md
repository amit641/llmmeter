---
title: CLI
description: Reference for the `llmmeter` binary.
---

```sh
npx @amit641/llmmeter-cli <command> [options]
```

| Command | What it does |
| --- | --- |
| `dashboard` | Open the local dashboard against a SQLite file. |
| `tail` | Live-tail incoming calls in the terminal. See [Live tail](/tooling/tail/). |
| `analyze` | Surface routing suggestions. See [Routing analyzer](/tooling/analyze/). |
| `serve` | Run the production collector + dashboard. |
| `export` | Dump all calls to JSONL or CSV. |
| `prune` | Delete records older than a duration (`30d`, `2w`). |
| `pricing list` | Print the bundled price table. |
| `version` | Print version. |

## Common flags

- `--db PATH` — SQLite file (default `./.llmmeter/llmmeter.db`)
- `--pg URL` — Postgres connection string (used by `serve` / `prune`)
- `--port N` — HTTP port
- `--ingest-token T` / `--dashboard-token T` — auth tokens for `serve`
- `--no-open` — don't auto-open the browser
