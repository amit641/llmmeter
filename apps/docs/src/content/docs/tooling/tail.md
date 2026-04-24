---
title: Live tail
description: tail -f for your LLM calls.
---

```sh
npx llmmeter tail --db ./.amit641/llmmeter.db --interval 500
```

Polls the database every `--interval` ms and prints every new call as it arrives. Errors are highlighted in red so a runaway loop is impossible to miss.

```text
time           provider/model                            in     out         $     ms  feature
--------------------------------------------------------------------------------------------------------------
    14:32:12.084  openai/gpt-4o-mini                       523    104   $0.00012   840  search
    14:32:12.319  openai/text-embedding-3-small             62      0   $0.00000    91  search
ERR 14:32:14.001  anthropic/claude-3-5-sonnet              810    320   $0.01275  9810  agent      RateLimitError: 429
```

Filters:

```sh
npx llmmeter tail --feature search
npx llmmeter tail --provider anthropic
```

Programmatic API:

```ts
import { tail } from "@llmmeter/cli";

const stop = await tail({ storage, intervalMs: 500, filters: { feature: "rag" } });
// later: stop()
```
