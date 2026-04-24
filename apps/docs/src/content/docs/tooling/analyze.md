---
title: Routing analyzer
description: Find features whose prompts succeed at a model 1/15th the cost.
---

```sh
npx llmmeter analyze --since 14d --include-untested
```

The analyzer looks at the last `--since` window and finds opportunities to save money:

1. **Tested suggestions.** Groups calls by `(feature, prompt_hash)` and looks for clusters where the same prompt was actually run against multiple models. If the cheaper model succeeded reliably, it suggests routing the rest to it. **High confidence** — based on real, observed traffic.
2. **Untested same-provider alternatives.** For each `(feature, model)` pair, finds cheaper models in the same provider family that are operation-compatible (chat ↔ chat, embedding ↔ embedding) and would have cost less for the average request profile. **Speculative** — labelled as "A/B before switching".

```text
Routing suggestions (window: 14d, 2 found)
--------------------------------------------------------------------------------

  support
    openai/gpt-4o  →  openai/gpt-4o-mini
    calls=1240  current=$0.012/call  candidate=$0.0008/call
    estimated savings: $13.91 over the window  (confidence 99.5%)
    reason: 213 historical calls handled the same prompt at 93% lower cost with 99.5% success.
```

Programmatic API:

```ts
import { analyzeRouting, suggestUntestedAlternatives } from "@llmmeter/cli";

const tested = await analyzeRouting({ storage });
const speculative = await suggestUntestedAlternatives({ storage });
```

Suggestions are heuristic — production teams should still A/B test before flipping a model in critical paths. But it surfaces the obvious wins ("80% of /support traffic could go to gpt-4o-mini") without any extra instrumentation.
