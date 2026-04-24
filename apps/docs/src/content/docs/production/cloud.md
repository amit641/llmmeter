---
title: Hosted cloud (coming soon)
description: Managed collector + dashboard at llmmeter.dev/cloud.
---

We're building a managed collector + dashboard so you don't have to run Docker yourself.

```ts
import { meter, httpSink } from "llmmeter";

const openai = meter(new OpenAI(), {
  sink: httpSink({
    url: "https://ingest.llmmeter.dev/v1",
    token: process.env.LLMMETER_CLOUD_TOKEN,
  }),
});
```

What's planned:

- One-click signup, no credit card for free tier (1M records / month)
- All the dashboards from the OSS version, plus team / org / project hierarchy
- Anomaly alerts (Slack, PagerDuty)
- Smart routing suggestions ([same algorithm as `llmmeter analyze`](/tooling/analyze/)) running continuously
- Cost forecasting based on the last 30 days

[Want early access?](https://github.com/amit641/llmmeter/issues/new?title=Cloud+early+access) Open an issue or watch the repo.

In the meantime, the OSS self-hosted version has feature parity with what the cloud will offer at launch.
