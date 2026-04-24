---
title: JSONL sink (default)
description: Append-only JSONL file. Default fallback sink.
---

```ts
import { jsonlSink } from "@amit641/llmmeter";

const sink = jsonlSink({ dir: "./.llmmeter", filename: "calls.jsonl" });
```

The JSONL sink is what runs if you don't pass `sink:` to `meter()`. It appends one JSON object per line to `./.llmmeter/calls.jsonl`. No dependencies, no indexes — just a guaranteed-durable file you can `tail -f` or feed into other tooling.

Use for:

- First-run / hello-world setups.
- Lambda / serverless where you only need to ship logs to S3 / CloudWatch.
- A backup sink alongside a primary one (`multiSink(primary, jsonlSink(...))`).
