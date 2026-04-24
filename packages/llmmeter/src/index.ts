/**
 * Umbrella entry. The README pitch is one line:
 *
 *   import { meter } from "@amit641/llmmeter";
 *   const openai = meter(new OpenAI());
 *
 * This `meter()` auto-detects the SDK shape and dispatches to the right adapter.
 * For zero-overhead/explicit usage, prefer `import { meter } from "@amit641/llmmeter/openai"`.
 */

import { meter as meterOpenAI } from "llmmeter-openai";
import { meter as meterAnthropic } from "llmmeter-anthropic";
import type { MeterOptions } from "llmmeter-core";

export type { MeterOptions, MeterContext, LLMCallRecord, Sink } from "llmmeter-core";
export {
  withContext,
  jsonlSink,
  httpSink,
  multiSink,
  memorySink,
  flushAll,
  shutdown,
  priceFor,
  PRICE_TABLE,
  BudgetExceededError,
} from "llmmeter-core";

/**
 * Auto-detect a supported LLM SDK and wrap it. Throws if the shape isn't recognized;
 * use the explicit subpath imports (`llmmeter/openai`, `llmmeter/anthropic`) instead.
 */
export function meter<T extends Record<string, any>>(client: T, options: MeterOptions = {}): T {
  if (isOpenAILike(client)) return meterOpenAI(client, options);
  if (isAnthropicLike(client)) return meterAnthropic(client, options);
  throw new Error(
    "[llmmeter] meter(): could not auto-detect SDK shape. " +
      "Use `import { meter } from '@amit641/llmmeter/openai'` (or '/anthropic') instead.",
  );
}

function isOpenAILike(c: Record<string, any>): boolean {
  return (
    typeof c?.chat?.completions?.create === "function" ||
    typeof c?.responses?.create === "function" ||
    typeof c?.embeddings?.create === "function"
  );
}

function isAnthropicLike(c: Record<string, any>): boolean {
  return typeof c?.messages?.create === "function" && !c?.chat;
}
