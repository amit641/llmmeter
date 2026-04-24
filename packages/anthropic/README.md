# llmmeter-anthropic

Anthropic SDK adapter for [llmmeter](https://github.com/amit641/llmmeter). Wraps an `Anthropic` client so `messages.create` (streaming and non-streaming) is recorded.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { meter } from "llmmeter-anthropic";

const anthropic = meter(new Anthropic());
```

Or via the umbrella:

```ts
import { meter } from "@amit641/llmmeter/anthropic";
```
