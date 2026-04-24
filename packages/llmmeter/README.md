# llmmeter

Drop-in observability and cost tracking for any LLM SDK. One line of code.

```ts
import OpenAI from "openai";
import { meter } from "llmmeter/openai";

const openai = meter(new OpenAI());
// use `openai` exactly as before — calls are now recorded
```

Then run `npx llmmeter dashboard`.

See the [main repo README](https://github.com/amit641/llmmeter) for full docs.

## Subpath imports

```ts
import { meter } from "llmmeter/openai";
import { meter } from "llmmeter/anthropic";
import { sqliteSink } from "llmmeter/sqlite";
import { postgresSink } from "llmmeter/postgres";

import { meter, withContext, httpSink, jsonlSink } from "llmmeter";
```
