/**
 * Generic fetch() wrapper. Records calls to any LLM provider whose URL we
 * recognize (OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter, DeepSeek,
 * xAI, Ollama, …). Calls to other URLs are passed through untouched.
 *
 * Use when:
 *   - You're using a custom HTTP client instead of an SDK
 *   - You want to instrument code you don't own
 *   - You're on Cloudflare Workers / Bun / Deno without a vendor SDK
 *
 * @example
 *   import { meterFetch } from "llmmeter-fetch";
 *   globalThis.fetch = meterFetch(globalThis.fetch);
 *
 * @example
 *   const fetch = meterFetch(globalThis.fetch, { feature: "chat" });
 *   await fetch("https://api.openai.com/v1/chat/completions", { ... });
 */

import {
  buildRecorder,
  type MeterContext,
  type MeterOptions,
  type Operation,
  type ProviderName,
  type TokenUsage,
} from "llmmeter-core";
import { findParser, looksLikeSse, type FetchParser, type ParsedResponse } from "./parsers.js";

export type { FetchParser, ParsedResponse } from "./parsers.js";
export { PARSERS } from "./parsers.js";

export interface FetchAdapterOptions extends MeterOptions {
  /** Override per-call context based on the request (e.g. derive from headers). */
  callContext?: (input: RequestInfo | URL, init?: RequestInit) => MeterContext | undefined;
  /** Add custom parsers (matched before built-ins). */
  parsers?: FetchParser[];
}

type FetchFn = typeof globalThis.fetch;

export function meterFetch(fetchImpl: FetchFn = globalThis.fetch, options: FetchAdapterOptions = {}): FetchFn {
  if (!fetchImpl) throw new Error("[llmmeter] meterFetch: no fetch implementation provided");
  const recorder = buildRecorder(options);
  const userParsers = options.parsers ?? [];

  const wrapped: FetchFn = async (input, init) => {
    const url = toUrl(input);
    if (!url) return fetchImpl(input, init);

    const parser = userParsers.find((p) => p.matches(url)) ?? findParser(url);
    if (!parser) return fetchImpl(input, init);

    const body = parseRequestBody(input, init);
    const detected = parser.detect(url, body);
    if (!detected) return fetchImpl(input, init);

    const callContext = options.callContext?.(input, init);
    const start = recorder.start({ prompt: body, callContext });

    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch (err) {
      void recorder.fail(start, {
        provider: detected.provider,
        model: detected.model,
        operation: detected.operation,
        errorClass: (err as Error)?.name ?? "FetchError",
        errorMessage: (err as Error)?.message,
      });
      throw err;
    }

    if (!response.ok) {
      const errBodyText = await safeReadText(response.clone());
      void recorder.fail(start, {
        provider: detected.provider,
        model: detected.model,
        operation: detected.operation,
        errorClass: `HTTP ${response.status}`,
        errorMessage: errBodyText.slice(0, 500),
      });
      return response;
    }

    if (looksLikeSse(url, body, response)) {
      return wrapStreamingResponse(response, parser, recorder, start, detected, body);
    }

    // Non-streaming: clone, parse, record, return original.
    const clone = response.clone();
    void clone
      .json()
      .then((j) => {
        const parsed = parser.parseJson(j);
        return recorder.finish(start, {
          provider: detected.provider,
          model: parsed.model ?? detected.model,
          operation: detected.operation,
          tokens: completeTokens(parsed.tokens),
          completion: parsed.completion,
        });
      })
      .catch((err) => {
        void recorder.fail(start, {
          provider: detected.provider,
          model: detected.model,
          operation: detected.operation,
          errorClass: "ParseError",
          errorMessage: (err as Error)?.message,
        });
      });
    return response;
  };

  return wrapped;
}

function toUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") return new URL(input);
    if (input instanceof URL) return input;
    if (input && typeof (input as Request).url === "string") return new URL((input as Request).url);
  } catch {
    return null;
  }
  return null;
}

function parseRequestBody(input: RequestInfo | URL, init?: RequestInit): unknown {
  const raw = init?.body ?? (input instanceof Request ? null : null);
  if (!raw) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

async function safeReadText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "";
  }
}

function completeTokens(t: Partial<TokenUsage> | undefined): TokenUsage {
  return {
    input: t?.input ?? 0,
    output: t?.output ?? 0,
    cachedInput: t?.cachedInput,
    reasoning: t?.reasoning,
    total: (t?.input ?? 0) + (t?.output ?? 0) + (t?.reasoning ?? 0),
  };
}

function wrapStreamingResponse(
  response: Response,
  parser: FetchParser,
  recorder: ReturnType<typeof buildRecorder>,
  start: ReturnType<ReturnType<typeof buildRecorder>["start"]>,
  detected: { provider: ProviderName; model: string; operation: Operation },
  _body: unknown,
): Response {
  if (!response.body) {
    void recorder.finish(start, {
      provider: detected.provider,
      model: detected.model,
      operation: detected.operation,
      tokens: completeTokens(undefined),
    });
    return response;
  }

  const accum: ParsedResponse = {};
  let firstChunkSeen = false;
  let finalized = false;
  let buffered = "";

  const finalize = (status: "ok" | "error", err?: unknown) => {
    if (finalized) return;
    finalized = true;
    if (status === "ok") {
      void recorder.finish(start, {
        provider: detected.provider,
        model: accum.model ?? detected.model,
        operation: detected.operation,
        tokens: completeTokens(accum.tokens),
        completion: accum.completion,
      });
    } else {
      void recorder.fail(start, {
        provider: detected.provider,
        model: accum.model ?? detected.model,
        operation: detected.operation,
        errorClass: (err as Error)?.name ?? "StreamError",
        errorMessage: (err as Error)?.message,
        tokens: completeTokens(accum.tokens),
      });
    }
  };

  const decoder = new TextDecoder();
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      try {
        controller.enqueue(chunk); // pass-through to caller
        if (!firstChunkSeen) {
          firstChunkSeen = true;
          recorder.firstToken(start);
        }
        buffered += decoder.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = findEventBoundary(buffered)) !== -1) {
          const raw = buffered.slice(0, idx);
          buffered = buffered.slice(idx + 2); // skip \n\n
          handleSseEvent(raw, parser, accum);
        }
      } catch (err) {
        finalize("error", err);
      }
    },
    flush() {
      try {
        if (buffered.trim()) handleSseEvent(buffered, parser, accum);
        finalize("ok");
      } catch (err) {
        finalize("error", err);
      }
    },
  });

  const piped = response.body.pipeThrough(transform);
  return new Response(piped, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function findEventBoundary(s: string): number {
  // SSE events are separated by a blank line ("\n\n"). Some servers emit "\r\n\r\n".
  const a = s.indexOf("\n\n");
  const b = s.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function handleSseEvent(raw: string, parser: FetchParser, accum: ParsedResponse) {
  // Each event is one or more lines starting with "data:" (and optional "event:").
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data);
      parser.parseStreamChunk?.(json, accum);
    } catch {
      // ignore non-JSON keep-alive / heartbeats
    }
  }
}
