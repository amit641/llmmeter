---
title: Quick start
description: Get llmmeter running in five minutes.
---

## 1. Install

```sh
npm install @amit641/llmmeter
```

## 2. Wrap your client

```ts
import OpenAI from "openai";
import { meter } from "@amit641/llmmeter";

const openai = meter(new OpenAI(), { feature: "chat" });

await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello!" }],
});
```

By default, calls are appended to `./.llmmeter/calls.jsonl` so you don't lose data on the first run.

## 3. Switch to SQLite for the dashboard

```ts
import { meter } from "@amit641/llmmeter";
import { sqliteSink } from "@amit641/llmmeter/sqlite";

const openai = meter(new OpenAI(), {
  sink: sqliteSink({ filePath: "./.llmmeter/llmmeter.db" }),
  feature: "chat",
});
```

```sh
npx @amit641/llmmeter-cli dashboard
# → http://localhost:3737
```

## 4. Attach context per request

```ts
import { withContext } from "@amit641/llmmeter";

await withContext({ userId: "usr_abc", feature: "search", traceId: "trc_123" }, async () => {
  await openai.chat.completions.create({ ... });
  await openai.embeddings.create({ ... });
});
```

Every call inside the closure inherits the context — even calls made deep inside other libraries.

## 5. Set a budget

```ts
const openai = meter(new OpenAI(), {
  sink: sqliteSink({ filePath: "./.llmmeter/llmmeter.db" }),
  maxDailySpendUsd: 50,
  onBudgetExceeded: "throw",
});
```

When you blow past `$50` for the day, llmmeter throws `BudgetExceededError` instead of silently making the call. Use `"warn"` to log instead of throwing.
