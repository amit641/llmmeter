import { AsyncLocalStorage } from "node:async_hooks";
import type { MeterContext } from "./types.js";

const storage = new AsyncLocalStorage<MeterContext>();

/**
 * Run a function with the given context attached. Any meter() call inside the
 * function (and any async work it spawns) will inherit these fields.
 *
 * @example
 *   await withContext({ userId: "u_42", feature: "summarize" }, async () => {
 *     await openai.chat.completions.create(...);
 *   });
 */
export function withContext<T>(ctx: MeterContext, fn: () => Promise<T>): Promise<T> {
  const merged: MeterContext = { ...(storage.getStore() ?? {}), ...ctx };
  return storage.run(merged, fn);
}

export function getContext(): MeterContext {
  return storage.getStore() ?? {};
}

/** Internal: merge call-site ctx, ALS ctx, and a fresh trace id. */
export function resolveContext(callSite: MeterContext, traceId: string): MeterContext {
  const als = getContext();
  return {
    traceId: callSite.traceId ?? als.traceId ?? traceId,
    parentId: callSite.parentId ?? als.parentId,
    userId: callSite.userId ?? als.userId,
    feature: callSite.feature ?? als.feature,
    conversationId: callSite.conversationId ?? als.conversationId,
    meta: { ...(als.meta ?? {}), ...(callSite.meta ?? {}) },
  };
}
