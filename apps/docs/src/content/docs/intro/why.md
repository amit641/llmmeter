---
title: Why llmmeter?
description: Why every team shipping LLM features needs cost observability from day one.
---

LLM bills surprise people for predictable reasons:

- **Token counts are invisible at call time.** Each `chat.completions.create` call burns somewhere between 200 and 200,000 tokens depending on the prompt, the response length, and whether you accidentally streamed the entire conversation history. You only see the damage at the end of the month.
- **Costs vary 100× across models.** `gpt-4o` is fifteen times more expensive than `gpt-4o-mini`. Most teams default to the strongest model "just to be safe" and never go back.
- **No per-feature attribution.** Vendor dashboards aggregate by API key. If you have three features sharing one key, you have no idea which one is the budget-eater.
- **No per-user attribution.** When a single user creates 40,000 calls because of a buggy retry loop, you find out from your bank — not your monitoring.
- **Streaming hides latency.** TTFT (time-to-first-token) is the metric that matters for user experience. Few SDKs surface it.

`llmmeter` solves all of this with a one-line wrapper around your existing SDK. No platform lock-in, no proxy in the request path, no vendor account required.

## What it records

For every call:

| Field | Example |
| --- | --- |
| `provider` / `model` / `operation` | `openai` / `gpt-4o-mini` / `chat` |
| `tokens.input` / `tokens.output` / `tokens.cachedInput` | `1240` / `523` / `820` |
| `costUsd` | `0.000312` |
| `durationMs` / `ttftMs` | `1840` / `220` |
| `userId` / `feature` / `traceId` | `usr_abc` / `support-bot` / `trc_xyz` |
| `promptHash` | SHA-256 of prompt content (deterministic, doesn't store the prompt) |
| `status` / `errorClass` | `error` / `RateLimitError` |

You can opt into recording the full prompt + completion (with PII redaction and sampling) when you want to debug.
