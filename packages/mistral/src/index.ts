/**
 * Mistral SDK adapter for llmmeter (works with @mistralai/mistralai v1+).
 *
 * Wraps `client.chat.complete`, `client.chat.stream`, `client.embeddings.create`,
 * and `client.fim.complete` / `client.fim.stream`.
 *
 * @example
 *   import { Mistral } from "@mistralai/mistralai";
 *   import { meter } from "@llmmeter/mistral";
 *
 *   const client = meter(new Mistral({ apiKey: process.env.MISTRAL_API_KEY! }));
 *   const r = await client.chat.complete({ model: "mistral-small-latest", messages });
 */

import {
  buildRecorder,
  type MeterContext,
  type MeterOptions,
  type Operation,
  type TokenUsage,
} from "@llmmeter/core";

const PROVIDER = "mistral" as const;

export interface MistralAdapterOptions extends MeterOptions {
  callContext?: (method: string, args: any[]) => MeterContext | undefined;
}

export function meter<T extends object>(client: T, options: MistralAdapterOptions = {}): T {
  const recorder = buildRecorder(options);

  function wrapNamespace(name: "chat" | "embeddings" | "fim", ns: any): any {
    if (!ns) return ns;
    return new Proxy(ns, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== "function") return value;
        const method = String(prop);

        if (name === "chat" && method === "complete")
          return (args: any) => wrappedComplete("chat", value.bind(target), args);
        if (name === "chat" && method === "stream")
          return (args: any) => wrappedStream("chat", value.bind(target), args);
        if (name === "fim" && method === "complete")
          return (args: any) => wrappedComplete("completion", value.bind(target), args);
        if (name === "fim" && method === "stream")
          return (args: any) => wrappedStream("completion", value.bind(target), args);
        if (name === "embeddings" && method === "create")
          return (args: any) => wrappedComplete("embedding", value.bind(target), args);

        return value.bind(target);
      },
    });
  }

  async function wrappedComplete(
    op: Operation,
    fn: (args: any) => Promise<any>,
    args: any,
  ) {
    const callContext = options.callContext?.("complete", [args]);
    const start = recorder.start({ prompt: args, callContext });
    try {
      const result = await fn(args);
      const u = result?.usage ?? {};
      void recorder.finish(start, {
        provider: PROVIDER,
        model: result?.model ?? args?.model ?? "unknown",
        operation: op,
        tokens: extractTokens(u),
        completion: op === "embedding" ? undefined : firstContent(result),
      });
      return result;
    } catch (err) {
      void recorder.fail(start, {
        provider: PROVIDER,
        model: args?.model ?? "unknown",
        operation: op,
        errorClass: (err as Error)?.name ?? "Error",
        errorMessage: (err as Error)?.message,
      });
      throw err;
    }
  }

  async function wrappedStream(op: Operation, fn: (args: any) => any, args: any) {
    const callContext = options.callContext?.("stream", [args]);
    const start = recorder.start({ prompt: args, callContext });
    let upstream: AsyncIterable<any>;
    try {
      upstream = await fn(args);
    } catch (err) {
      void recorder.fail(start, {
        provider: PROVIDER,
        model: args?.model ?? "unknown",
        operation: op,
        errorClass: (err as Error)?.name ?? "Error",
        errorMessage: (err as Error)?.message,
      });
      throw err;
    }

    const modelHint = args?.model ?? "unknown";
    return wrapAsyncIterable(upstream, op, modelHint, start);
  }

  async function* wrapAsyncIterable(
    src: AsyncIterable<any>,
    op: Operation,
    modelHint: string,
    start: ReturnType<typeof recorder.start>,
  ) {
    let firstSeen = false;
    let assembled = "";
    let tokens: TokenUsage = { input: 0, output: 0 };
    let model = modelHint;
    try {
      for await (const event of src) {
        if (!firstSeen) {
          firstSeen = true;
          recorder.firstToken(start);
        }
        const data = event?.data ?? event;
        if (data?.model) model = data.model;
        const delta = data?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") assembled += delta;
        if (data?.usage) tokens = extractTokens(data.usage);
        yield event;
      }
      void recorder.finish(start, {
        provider: PROVIDER,
        model,
        operation: op,
        tokens,
        completion: assembled || undefined,
      });
    } catch (err) {
      void recorder.fail(start, {
        provider: PROVIDER,
        model,
        operation: op,
        errorClass: (err as Error)?.name ?? "Error",
        errorMessage: (err as Error)?.message,
        tokens,
      });
      throw err;
    }
  }

  return new Proxy(client as any, {
    get(target, prop) {
      const value = (target as any)[prop];
      if (prop === "chat" || prop === "embeddings" || prop === "fim") {
        return wrapNamespace(prop, value);
      }
      return value;
    },
  });
}

function extractTokens(u: any): TokenUsage {
  return {
    input: u?.promptTokens ?? u?.prompt_tokens ?? 0,
    output: u?.completionTokens ?? u?.completion_tokens ?? 0,
    total: u?.totalTokens ?? u?.total_tokens,
  };
}

function firstContent(result: any): string | undefined {
  const c = result?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
  return undefined;
}
