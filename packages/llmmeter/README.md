# @amit641/llmmeter

Drop-in observability and cost tracking for any LLM SDK. One line of code.

```ts
import OpenAI from "openai";
import { meter } from "@amit641/llmmeter/openai";

const openai = meter(new OpenAI());
// use `openai` exactly as before — calls are now recorded
```

Then run `npx @amit641/llmmeter-cli dashboard`.

See the [main repo README](https://github.com/amit641/llmmeter) for full docs.

## Subpath imports

```ts
import { meter } from "@amit641/llmmeter/openai";
import { meter } from "@amit641/llmmeter/anthropic";
import { sqliteSink } from "@amit641/llmmeter/sqlite";
import { postgresSink } from "@amit641/llmmeter/postgres";

import { meter, withContext, httpSink, jsonlSink } from "@amit641/llmmeter";
```
