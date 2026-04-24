/**
 * Google Generative AI adapter for llmmeter.
 *
 * Wraps the model returned from `genAI.getGenerativeModel({ model })` and
 * intercepts `generateContent`, `generateContentStream`, and `embedContent`.
 *
 * @example
 *   import { GoogleGenerativeAI } from "@google/generative-ai";
 *   import { meter } from "llmmeter-google";
 *
 *   const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
 *   const model = meter(genAI.getGenerativeModel({ model: "gemini-1.5-pro" }));
 *   const r = await model.generateContent("Hello");
 */

import {
  buildRecorder,
  type MeterContext,
  type MeterOptions,
  type Operation,
  type TokenUsage,
} from "llmmeter-core";

const PROVIDER = "google" as const;

export interface GoogleAdapterOptions extends MeterOptions {
  callContext?: (method: string, args: any[]) => MeterContext | undefined;
}

export function meter<T extends object>(model: T, options: GoogleAdapterOptions = {}): T {
  const recorder = buildRecorder(options);
  const modelName: string = (model as any)?.model ?? "unknown";

  return new Proxy(model as any, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      const method = String(prop);
      if (method === "generateContent") {
        return async (...args: any[]) => {
          const callContext = options.callContext?.(method, args);
          const start = recorder.start({ prompt: args[0], callContext });
          try {
            const result = await value.apply(target, args);
            const usage = result?.response?.usageMetadata ?? {};
            void recorder.finish(start, {
              provider: PROVIDER,
              model: modelName,
              operation: "chat" as Operation,
              tokens: extractTokens(usage),
              completion: tryText(result?.response),
            });
            return result;
          } catch (err) {
            void recorder.fail(start, {
              provider: PROVIDER,
              model: modelName,
              operation: "chat" as Operation,
              errorClass: (err as Error)?.name ?? "Error",
              errorMessage: (err as Error)?.message,
            });
            throw err;
          }
        };
      }

      if (method === "generateContentStream") {
        return async (...args: any[]) => {
          const callContext = options.callContext?.(method, args);
          const start = recorder.start({ prompt: args[0], callContext });
          let result: any;
          try {
            result = await value.apply(target, args);
          } catch (err) {
            void recorder.fail(start, {
              provider: PROVIDER,
              model: modelName,
              operation: "chat",
              errorClass: (err as Error)?.name ?? "Error",
              errorMessage: (err as Error)?.message,
            });
            throw err;
          }
          // Wrap the iterator to detect first token, and finalize after `response` resolves.
          const originalStream = result.stream;
          const originalResponsePromise = result.response;
          let firstSeen = false;
          let assembled = "";

          async function* wrappedStream() {
            try {
              for await (const chunk of originalStream) {
                if (!firstSeen) {
                  firstSeen = true;
                  recorder.firstToken(start);
                }
                const piece = tryText(chunk);
                if (piece) assembled += piece;
                yield chunk;
              }
            } catch (err) {
              void recorder.fail(start, {
                provider: PROVIDER,
                model: modelName,
                operation: "chat",
                errorClass: (err as Error)?.name ?? "Error",
                errorMessage: (err as Error)?.message,
              });
              throw err;
            }
          }

          const wrappedResponsePromise = (async () => {
            const resp = await originalResponsePromise;
            const usage = resp?.usageMetadata ?? {};
            void recorder.finish(start, {
              provider: PROVIDER,
              model: modelName,
              operation: "chat",
              tokens: extractTokens(usage),
              completion: assembled || tryText(resp),
            });
            return resp;
          })();

          return { stream: wrappedStream(), response: wrappedResponsePromise };
        };
      }

      if (method === "embedContent" || method === "batchEmbedContents") {
        return async (...args: any[]) => {
          const callContext = options.callContext?.(method, args);
          const start = recorder.start({ prompt: args[0], callContext });
          try {
            const result = await value.apply(target, args);
            // embedContent does not return usage; we pass 0 tokens but still record latency.
            void recorder.finish(start, {
              provider: PROVIDER,
              model: modelName,
              operation: "embedding",
              tokens: { input: 0, output: 0 },
            });
            return result;
          } catch (err) {
            void recorder.fail(start, {
              provider: PROVIDER,
              model: modelName,
              operation: "embedding",
              errorClass: (err as Error)?.name ?? "Error",
              errorMessage: (err as Error)?.message,
            });
            throw err;
          }
        };
      }

      // Other methods (countTokens, startChat, etc.) are passed through unchanged.
      return value.bind(target);
    },
  });
}

function extractTokens(u: any): TokenUsage {
  return {
    input: u?.promptTokenCount ?? 0,
    output: u?.candidatesTokenCount ?? 0,
    cachedInput: u?.cachedContentTokenCount,
    reasoning: u?.thoughtsTokenCount,
    total: u?.totalTokenCount,
  };
}

function tryText(response: any): string | undefined {
  try {
    if (typeof response?.text === "function") return response.text();
    const parts = response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) return parts.map((p: any) => p?.text ?? "").join("");
  } catch {
    // ignore
  }
  return undefined;
}
