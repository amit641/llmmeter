/**
 * Anthropic SDK adapter for llmmeter.
 *
 * Wraps `messages.create` (non-streaming and streaming). The Anthropic stream
 * emits typed events; we accumulate `output_tokens` from `message_delta` events
 * and read input/cached tokens from the initial `message_start` event.
 */

import {
  buildRecorder,
  type MeterContext,
  type MeterOptions,
  type TokenUsage,
} from "@llmmeter/core";

type AnyAnthropic = Record<string, any>;

export interface AnthropicAdapterOptions extends MeterOptions {
  callContext?: (body: any) => MeterContext | undefined;
}

export function meter<T extends AnyAnthropic>(client: T, options: AnthropicAdapterOptions = {}): T {
  const recorder = buildRecorder(options);

  const wrap = (target: any, path: string[]): any =>
    new Proxy(target, {
      get(t, prop, recv) {
        const value = Reflect.get(t, prop, recv);
        if (typeof prop !== "string") return value;
        const newPath = [...path, prop];
        if (newPath.join(".") === "messages.create" && typeof value === "function") {
          return wrapCreate(value.bind(t), options, recorder);
        }
        if (value && typeof value === "object") return wrap(value, newPath);
        return value;
      },
    });

  return wrap(client, []) as T;
}

function wrapCreate(
  fn: (body: any, opts?: any) => any,
  options: AnthropicAdapterOptions,
  recorder: ReturnType<typeof buildRecorder>,
) {
  return function metered(body: any, opts?: any) {
    const callContext = options.callContext?.(body);
    const start = recorder.start({ prompt: body, callContext });

    let result: unknown;
    try {
      result = fn(body, opts);
    } catch (err) {
      void recorder.fail(start, {
        provider: "anthropic",
        model: body?.model ?? "unknown",
        operation: "chat",
        errorClass: (err as Error)?.name ?? "Error",
        errorMessage: (err as Error)?.message,
      });
      throw err;
    }

    if (isPromise(result)) {
      return (result as Promise<any>).then(
        (resolved) => {
          if (isAsyncIterable(resolved)) return wrapStream(resolved, recorder, start, body);
          void recordSuccess(recorder, start, body, resolved);
          return resolved;
        },
        (err) => {
          void recorder.fail(start, {
            provider: "anthropic",
            model: body?.model ?? "unknown",
            operation: "chat",
            errorClass: (err as Error)?.name ?? "Error",
            errorMessage: (err as Error)?.message,
          });
          throw err;
        },
      );
    }
    if (isAsyncIterable(result)) return wrapStream(result, recorder, start, body);
    void recordSuccess(recorder, start, body, result);
    return result;
  };
}

function isPromise(v: unknown): v is PromiseLike<unknown> {
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
        provider: "anthropic",
        model,
        operation: "chat",
        tokens,
        completion: assembled || undefined,
      });
    } else {
      await recorder.fail(start, {
        provider: "anthropic",
        model,
        operation: "chat",
        errorClass: status === "cancelled" ? "CancelledError" : (err as Error)?.name ?? "Error",
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
              const ev = r.value;
              switch (ev.type) {
                case "message_start":
                  if (ev.message?.model) model = ev.message.model;
                  if (ev.message?.usage) {
                    tokens.input = ev.message.usage.input_tokens ?? 0;
                    if (typeof ev.message.usage.cache_read_input_tokens === "number") {
                      tokens.cachedInput = ev.message.usage.cache_read_input_tokens;
                    }
                  }
                  break;
                case "content_block_delta":
                  if (typeof ev.delta?.text === "string") assembled += ev.delta.text;
                  break;
                case "message_delta":
                  if (typeof ev.usage?.output_tokens === "number") {
                    tokens.output = ev.usage.output_tokens;
                  }
                  break;
              }
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
) {
  const u = result?.usage ?? {};
  const tokens: TokenUsage = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
  };
  if (typeof u.cache_read_input_tokens === "number") {
    tokens.cachedInput = u.cache_read_input_tokens;
  }
  const completion = Array.isArray(result?.content)
    ? result.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("")
    : undefined;
  return recorder.finish(start, {
    provider: "anthropic",
    model: result?.model ?? body?.model ?? "unknown",
    operation: "chat",
    tokens,
    completion,
  });
}
