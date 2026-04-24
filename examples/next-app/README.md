# Next.js + llmmeter example

This snippet shows the minimal wiring inside a Next.js App Router route.

## File: `lib/openai.ts`

Wrap your client once and reuse it everywhere.

```ts
import OpenAI from "openai";
import { meter } from "llmmeter/openai";
import { sqliteSink } from "llmmeter/sqlite"; // dev / single-instance prod
// import { httpSink } from "llmmeter";       // multi-instance / edge
// import { postgresSink } from "llmmeter/postgres"; // self-hosted prod

export const openai = meter(new OpenAI(), {
  sink: sqliteSink({ filePath: ".amit641/llmmeter.db" }),
  recordPayload: false,
  maxDailySpendUsd: 50,
  onBudgetExceeded: "warn",
});
```

## File: `app/api/chat/route.ts`

```ts
import { openai } from "@/lib/openai";
import { withContext } from "llmmeter";

export async function POST(req: Request) {
  const { message, userId } = await req.json();
  return withContext(
    { userId, feature: "chat", conversationId: req.headers.get("x-conv-id") ?? undefined },
    async () => {
      const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: message }],
      });
      return Response.json({ reply: r.choices[0]?.message?.content });
    },
  );
}
```

## Production: switch the sink

For Vercel / multi-instance / edge, swap the SQLite sink for HTTP:

```ts
import { meter, httpSink } from "llmmeter";

export const openai = meter(new OpenAI(), {
  sink: httpSink({
    url: process.env.LLMMETER_COLLECTOR_URL!,    // e.g. https://llmmeter.your-domain.com/ingest
    apiKey: process.env.LLMMETER_INGEST_TOKEN!,
  }),
});
```

Run the collector somewhere persistent:

```bash
docker run -d \
  -e LLMMETER_DB_URL=postgres://... \
  -e LLMMETER_INGEST_TOKEN=... \
  -e LLMMETER_DASHBOARD_TOKEN=... \
  -p 8080:8080 \
  ghcr.io/llmmeter/server:latest
```
