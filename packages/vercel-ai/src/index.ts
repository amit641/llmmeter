/**
 * Vercel AI SDK adapter for llmmeter.
 *
 * Wraps the top-level `generateText`, `streamText`, `embed`, `embedMany`, and
 * `generateObject` functions. The SDK exposes token usage in a stable shape
 * across model providers, so we just normalise it.
 *
 * @example
 *   import { generateText, streamText, embed } from "ai";
 *   import { meter } from "llmmeter-vercel-ai";
 *
 *   const ai = meter({ generateText, streamText, embed });
 *   const { text, usage } = await ai.generateText({ model: openai("gpt-4o-mini"), prompt: "hi" });
 */

import {
  buildRecorder,
  type MeterContext,
  type MeterOptions,
  type Operation,
  type ProviderName,
  type TokenUsage,
} from "llmmeter-core";

const KNOWN_PROVIDERS: Array<{ prefix: string; name: ProviderName }> = [
  { prefix: "openai", name: "openai" },
  { prefix: "anthropic", name: "anthropic" },
  { prefix: "google", name: "google" },
  { prefix: "mistral", name: "mistral" },
  { prefix: "groq", name: "groq" },
  { prefix: "cohere", name: "cohere" },
  { prefix: "deepseek", name: "deepseek" },
  { prefix: "xai", name: "xai" },
  { prefix: "ollama", name: "ollama" },
  { prefix: "openrouter", name: "openrouter" },
];

function detectProvider(model: any): { provider: ProviderName; modelId: string } {
  // Vercel AI SDK v3+ models have `provider` (e.g. "openai.chat") and `modelId`.
  const providerStr = String(model?.provider ?? "");
  const modelId = String(model?.modelId ?? model?.id ?? "unknown");
  for (const { prefix, name } of KNOWN_PROVIDERS) {
    if (providerStr.toLowerCase().startsWith(prefix)) return { provider: name, modelId };
  }
  return { provider: "custom", modelId };
}

function normaliseUsage(u: any): TokenUsage {
  if (!u) return { input: 0, output: 0 };
  // SDK normalised: { promptTokens, completionTokens, totalTokens }
  // Some embed APIs use { tokens }
  return {
    input: u.promptTokens ?? u.tokens ?? u.inputTokens ?? 0,
    output: u.completionTokens ?? u.outputTokens ?? 0,
    cachedInput: u.cachedInputTokens ?? u.cachePromptTokens ?? undefined,
    reasoning: u.reasoningTokens ?? undefined,
    total: u.totalTokens,
  };
}

export interface VercelAIAdapterOptions extends MeterOptions {
  callContext?: (params: any) => MeterContext | undefined;
}

interface AiFns {
  generateText?: (params: any) => Promise<any>;
  streamText?: (params: any) => any;
  generateObject?: (params: any) => Promise<any>;
  streamObject?: (params: any) => any;
  embed?: (params: any) => Promise<any>;
  embedMany?: (params: any) => Promise<any>;
}

export function meter<T extends AiFns>(fns: T, options: VercelAIAdapterOptions = {}): T {
  const recorder = buildRecorder(options);
  const out: AiFns = {};

  if (fns.generateText) {
    out.generateText = wrapAwaited(fns.generateText, "chat", recorder, options);
  }
  if (fns.generateObject) {
    out.generateObject = wrapAwaited(fns.generateObject, "chat", recorder, options);
  }
  if (fns.embed) {
    out.embed = wrapAwaited(fns.embed, "embedding", recorder, options);
  }
  if (fns.embedMany) {
    out.embedMany = wrapAwaited(fns.embedMany, "embedding", recorder, options);
  }
  if (fns.streamText) {
    out.streamText = wrapStreaming(fns.streamText, "chat", recorder, options);
  }
  if (fns.streamObject) {
    out.streamObject = wrapStreaming(fns.streamObject, "chat", recorder, options);
  }

  return out as T;
}

function wrapAwaited(
  fn: (params: any) => Promise<any>,
  operation: Operation,
  recorder: ReturnType<typeof buildRecorder>,
  options: VercelAIAdapterOptions,
) {
  return async (params: any) => {
    const callContext = options.callContext?.(params);
    const start = recorder.start({ prompt: extractPrompt(params), callContext });
    const { provider, modelId } = detectProvider(params?.model);
    try {
      const result = await fn(params);
      const tokens = normaliseUsage(await Promise.resolve(result?.usage));
      void recorder.finish(start, {
        provider,
        model: result?.response?.modelId ?? modelId,
        operation,
        tokens,
        completion: result?.text ?? result?.object ?? undefined,
      });
      return result;
    } catch (err) {
      void recorder.fail(start, {
        provider,
        model: modelId,
        operation,
        errorClass: (err as Error)?.name ?? "Error",
        errorMessage: (err as Error)?.message,
      });
      throw err;
    }
  };
}

function wrapStreaming(
  fn: (params: any) => any,
  operation: Operation,
  recorder: ReturnType<typeof buildRecorder>,
  options: VercelAIAdapterOptions,
) {
  return (params: any) => {
    const callContext = options.callContext?.(params);
    const start = recorder.start({ prompt: extractPrompt(params), callContext });
    const { provider, modelId } = detectProvider(params?.model);

    // Chain user-supplied onFinish so we can record the usage when streaming completes.
    const userOnFinish = params?.onFinish;
    const wrappedParams = {
      ...params,
      onChunk: (chunk: any) => {
        recorder.firstToken(start);
        params?.onChunk?.(chunk);
      },
      onFinish: async (result: any) => {
        try {
          const tokens = normaliseUsage(result?.usage);
          await recorder.finish(start, {
            provider,
            model: result?.response?.modelId ?? modelId,
            operation,
            tokens,
            completion: result?.text ?? result?.object ?? undefined,
          });
        } catch {
          // never throw to user
        }
        return userOnFinish?.(result);
      },
      onError: async (err: unknown) => {
        try {
          await recorder.fail(start, {
            provider,
            model: modelId,
            operation,
            errorClass: (err as Error)?.name ?? "Error",
            errorMessage: (err as Error)?.message,
          });
        } catch {
          // never throw
        }
        return params?.onError?.(err);
      },
    };

    return fn(wrappedParams);
  };
}

function extractPrompt(params: any): unknown {
  if (params?.messages) return params.messages;
  if (params?.prompt) return params.prompt;
  if (params?.value) return params.value;
  if (params?.values) return params.values;
  return params;
}
