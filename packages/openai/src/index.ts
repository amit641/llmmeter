/**
 * OpenAI SDK adapter for llmmeter.
 *
 * Wraps an `OpenAI` client instance with a Proxy. We intercept three method
 * paths that cover ~99% of usage:
 *   - openai.chat.completions.create
 *   - openai.embeddings.create
 *   - openai.responses.create  (new Responses API, optional)
 *
 * Streaming is detected by the `stream: true` flag in the request body. When
 * present we wrap the returned async-iterable so we can compute TTFT and final
 * usage from the stream's last chunk (`stream_options: { include_usage: true }`
 * is auto-injected if not set).
 */

import {
  buildRecorder,
  type LLMCallRecord,
  type MeterContext,
  type MeterOptions,
  type Operation,
  type TokenUsage,
} from "llmmeter-core";

type AnyOpenAI = Record<string, any>;
type CreateFn = (body: any, opts?: any) => any;

interface AdapterMeta {
  operation: Operation;
  defaultModel?: string;
}

const TARGETS: Record<string, AdapterMeta> = {
  "chat.completions.create": { operation: "chat" },
  "embeddings.create": { operation: "embedding" },
  "responses.create": { operation: "chat" },
  "moderations.create": { operation: "moderation" },
  "images.generate": { operation: "image" },
};

export interface OpenAIAdapterOptions extends MeterOptions {
  /** Override `meter()` defaults at call time per request via a getter. */
  callContext?: (body: any) => MeterContext | undefined;
}

/**
 * Wrap an OpenAI client instance.
 *
 * @example
 *   import OpenAI from "openai";
 *   import { meter } from "llmmeter-openai";
 *   const openai = meter(new OpenAI());
 */
export function meter<T extends AnyOpenAI>(client: T, options: OpenAIAdapterOptions = {}): T {
  const recorder = buildRecorder(options);

  const wrap = (target: any, path: string[]): any => {
    return new Proxy(target, {
      get(t, prop, recv) {
        const value = Reflect.get(t, prop, recv);
        if (typeof prop !== "string") return value;
        const newPath = [...path, prop];
        const dotted = newPath.join(".");
        if (TARGETS[dotted] && typeof value === "function") {
          return wrapCreate(value.bind(t), TARGETS[dotted], options, recorder);
        }
        if (value && typeof value === "object") {
          return wrap(value, newPath);
        }
        return value;
      },
    });
  };

  return wrap(client, []) as T;
}

// ---------------- internals ---------------- //

function wrapCreate(
  fn: CreateFn,
  meta: AdapterMeta,
  options: OpenAIAdapterOptions,
  recorder: ReturnType<typeof buildRecorder>,
): CreateFn {
  return function metered(body: any, opts?: any) {
    const callContext = options.callContext?.(body);
    const start = recorder.start({ prompt: body, callContext });

    // For streaming chat, ensure we get usage in the final chunk.
    if (body?.stream === true && meta.operation === "chat") {
      body = {
        ...body,
        stream_options: { include_usage: true, ...(body.stream_options ?? {}) },
      };
    }

    let result: unknown;
    try {
      result = fn(body, opts);
    } catch (err) {
      recordSyncFailure(recorder, start, body, meta, err);
      throw err;
    }

    if (isPromiseLike(result)) {
      return (result as Promise<any>).then(
        (resolved) => {
          if (isAsyncIterable(resolved)) {
            return wrapStream(resolved, recorder, start, body, meta);
          }
          void recordSuccess(recorder, start, body, resolved, meta);
          return resolved;
        },
        (err) => {
          void recordFailure(recorder, start, body, meta, err);
          throw err;
        },
      );
    }

    if (isAsyncIterable(result)) {
      return wrapStream(result, recorder, start, body, meta);
    }

    void recordSuccess(recorder, start, body, result, meta);
    return result;
  };
}

function isPromiseLike(v: unknown): v is PromiseLike<unknown> {
  return !!v && typeof (v as { then?: unknown }).then === "function";
}

function isAsyncIterable<T = unknown>(v: unknown): v is AsyncIterable<T> {
  return !!v && typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function wrapStream(
  source: AsyncIterable<any>,
  recorder: ReturnType<typeof buildRecorder>,
  start: ReturnType<ReturnType<typeof buildRecorder>["start"]>,
  body: any,
  meta: AdapterMeta,
): AsyncIterable<any> {
  const tokens: TokenUsage = { input: 0, output: 0 };
  let model: string = body?.model ?? "unknown";
  let firstChunkSeen = false;
  let assembled = "";
  let finalized = false;

  const finalize = async (status: "ok" | "cancelled" | "error", err?: unknown) => {
    if (finalized) return;
    finalized = true;
    if (status === "ok") {
      await recorder.finish(start, {
        provider: "openai",
        model,
        operation: meta.operation,
        tokens,
        completion: assembled || undefined,
      });
    } else if (status === "cancelled") {
      await recorder.fail(start, {
        provider: "openai",
        model,
        operation: meta.operation,
        errorClass: "CancelledError",
        tokens,
      });
    } else {
      await recorder.fail(start, {
        provider: "openai",
        model,
        operation: meta.operation,
        errorClass: (err as Error)?.name ?? "Error",
        errorMessage: (err as Error)?.message,
        tokens,
      });
    }
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<any> {
      const inner = source[Symbol.asyncIterator]();
      return {
        async next() {
          try {
            const r = await inner.next();
            if (!firstChunkSeen) {
              firstChunkSeen = true;
              recorder.firstToken(start);
            }
            if (!r.done && r.value) {
              const chunk = r.value;
              if (chunk?.model) model = chunk.model;
              if (chunk?.usage) {
                tokens.input = chunk.usage.prompt_tokens ?? tokens.input;
                tokens.output = chunk.usage.completion_tokens ?? tokens.output;
                const cached = chunk.usage.prompt_tokens_details?.cached_tokens;
                if (typeof cached === "number") tokens.cachedInput = cached;
                const reasoning = chunk.usage.completion_tokens_details?.reasoning_tokens;
                if (typeof reasoning === "number") tokens.reasoning = reasoning;
              }
              const delta = chunk?.choices?.[0]?.delta?.content;
              if (typeof delta === "string") assembled += delta;
            } else if (r.done) {
              await finalize("ok");
            }
            return r;
          } catch (err) {
            await finalize("error", err);
            throw err;
          }
        },
        async return(value?: any) {
          await finalize("cancelled");
          return inner.return ? inner.return(value) : { value, done: true };
        },
        async throw(err?: any) {
          await finalize("error", err);
          if (inner.throw) return inner.throw(err);
          throw err;
        },
      };
    },
  };
}

async function recordSuccess(
  recorder: ReturnType<typeof buildRecorder>,
  start: ReturnType<ReturnType<typeof buildRecorder>["start"]>,
  body: any,
  result: any,
  meta: AdapterMeta,
): Promise<LLMCallRecord> {
  const tokens = extractTokens(result, body, meta);
  const model = result?.model ?? body?.model ?? "unknown";
  const completion = extractCompletion(result, meta);
  return recorder.finish(start, {
    provider: "openai",
    model,
    operation: meta.operation,
    tokens,
    completion,
  });
}

async function recordFailure(
  recorder: ReturnType<typeof buildRecorder>,
  start: ReturnType<ReturnType<typeof buildRecorder>["start"]>,
  body: any,
  meta: AdapterMeta,
  err: unknown,
) {
  const e = err as { name?: string; message?: string; status?: number };
  return recorder.fail(start, {
    provider: "openai",
    model: body?.model ?? "unknown",
    operation: meta.operation,
    errorClass: e?.name ?? `HTTP ${e?.status ?? "?"}`,
    errorMessage: e?.message,
  });
}

function recordSyncFailure(
  recorder: ReturnType<typeof buildRecorder>,
  start: ReturnType<ReturnType<typeof buildRecorder>["start"]>,
  body: any,
  meta: AdapterMeta,
  err: unknown,
) {
  void recordFailure(recorder, start, body, meta, err);
}

function extractTokens(result: any, body: any, meta: AdapterMeta): TokenUsage {
  if (meta.operation === "embedding") {
    const input = result?.usage?.prompt_tokens ?? estimateEmbeddingInput(body);
    return { input, output: 0 };
  }
  const u = result?.usage ?? {};
  const tokens: TokenUsage = {
    input: u.prompt_tokens ?? 0,
    output: u.completion_tokens ?? 0,
  };
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (typeof cached === "number") tokens.cachedInput = cached;
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (typeof reasoning === "number") tokens.reasoning = reasoning;
  return tokens;
}

function estimateEmbeddingInput(body: any): number {
  const input = body?.input;
  if (typeof input === "string") return Math.ceil(input.length / 4);
  if (Array.isArray(input)) {
    return input.reduce(
      (sum: number, v: unknown) => sum + (typeof v === "string" ? Math.ceil(v.length / 4) : 0),
      0,
    );
  }
  return 0;
}

function extractCompletion(result: any, meta: AdapterMeta): unknown {
  if (meta.operation === "chat") {
    return result?.choices?.[0]?.message?.content ?? result?.output_text ?? undefined;
  }
  if (meta.operation === "embedding") {
    return undefined; // don't store giant float arrays
  }
  return result;
}
