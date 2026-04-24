---
title: Google Gemini adapter
description: Wrap `@google/generative-ai` models with one call.
---

```ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { meter } from "@llmmeter/google";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
const model = meter(genAI.getGenerativeModel({ model: "gemini-1.5-pro" }));

const r = await model.generateContent("Hello");
const stream = await model.generateContentStream("Tell me a story");
```

Wraps `generateContent`, `generateContentStream`, `embedContent`, and `batchEmbedContents`. Reads `usageMetadata` for `promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount`, and `thoughtsTokenCount` (reasoning).
