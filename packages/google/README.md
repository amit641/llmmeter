# @llmmeter/google

Google Generative AI SDK adapter for [llmmeter](https://github.com/amit641/llmmeter).

```ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { meter } from "@llmmeter/google";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
const model = meter(genAI.getGenerativeModel({ model: "gemini-1.5-pro" }));

const r = await model.generateContent("Hello");
```

Streaming via `generateContentStream` is fully supported: TTFT is captured on the first chunk and final usage on `response`.
