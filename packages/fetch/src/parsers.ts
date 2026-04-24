/**
 * URL/body/response parsers for the major LLM providers.
 *
 * Each parser knows how to:
 *   - match an outgoing request URL
 *   - identify provider + operation + model
 *   - extract token counts from a non-streaming JSON response
 *   - extract token counts from an SSE stream chunk
 */

import type { Operation, ProviderName, TokenUsage } from "llmmeter-core";

export interface DetectedRequest {
  provider: ProviderName;
  operation: Operation;
  model: string;
}

export interface ParsedResponse {
  model?: string;
  tokens?: Partial<TokenUsage>;
  completion?: string;
}

export interface FetchParser {
  matches(url: URL): boolean;
  detect(url: URL, body: unknown): DetectedRequest | null;
  parseJson(json: any): ParsedResponse;
  /** SSE chunk parser. Called for every parsed `data: …` event. */
  parseStreamChunk?(event: any, accum: ParsedResponse): void;
  /** Streaming responses: opt-in to extracting token usage from final chunk. */
  isStreaming?(body: unknown, response: Response): boolean;
}

const json = (b: unknown): any => (b && typeof b === "object" ? (b as any) : {});

// ---------------- OpenAI ---------------- //

const openaiParser: FetchParser = {
  matches: (u) => /(?:^|\.)(api\.openai\.com|api\.deepseek\.com)$/.test(u.hostname),
  detect(u, body) {
    const provider: ProviderName = u.hostname.endsWith("deepseek.com") ? "deepseek" : "openai";
    const b = json(body);
    if (u.pathname.includes("/chat/completions")) return { provider, operation: "chat", model: b.model ?? "unknown" };
    if (u.pathname.includes("/responses")) return { provider, operation: "chat", model: b.model ?? "unknown" };
    if (u.pathname.includes("/completions")) return { provider, operation: "completion", model: b.model ?? "unknown" };
    if (u.pathname.includes("/embeddings")) return { provider, operation: "embedding", model: b.model ?? "unknown" };
    if (u.pathname.includes("/moderations")) return { provider, operation: "moderation", model: b.model ?? "text-moderation-latest" };
    if (u.pathname.includes("/images/")) return { provider, operation: "image", model: b.model ?? "dall-e-3" };
    if (u.pathname.includes("/audio/")) return { provider, operation: "audio", model: b.model ?? "whisper-1" };
    return null;
  },
  parseJson(j) {
    const u = j?.usage ?? {};
    const tokens: Partial<TokenUsage> = {
      input: u.prompt_tokens ?? 0,
      output: u.completion_tokens ?? 0,
    };
    if (typeof u.prompt_tokens_details?.cached_tokens === "number") tokens.cachedInput = u.prompt_tokens_details.cached_tokens;
    if (typeof u.completion_tokens_details?.reasoning_tokens === "number") tokens.reasoning = u.completion_tokens_details.reasoning_tokens;
    return {
      model: j?.model,
      tokens,
      completion: j?.choices?.[0]?.message?.content ?? j?.output_text ?? undefined,
    };
  },
  parseStreamChunk(ev, acc) {
    if (ev?.model) acc.model = ev.model;
    if (ev?.usage) {
      acc.tokens = {
        ...(acc.tokens ?? {}),
        input: ev.usage.prompt_tokens ?? acc.tokens?.input ?? 0,
        output: ev.usage.completion_tokens ?? acc.tokens?.output ?? 0,
      };
      const cached = ev.usage.prompt_tokens_details?.cached_tokens;
      if (typeof cached === "number") acc.tokens.cachedInput = cached;
    }
    const delta = ev?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") acc.completion = (acc.completion ?? "") + delta;
  },
  isStreaming: (body) => json(body).stream === true,
};

// ---------------- Anthropic ---------------- //

const anthropicParser: FetchParser = {
  matches: (u) => u.hostname === "api.anthropic.com",
  detect(u, body) {
    const b = json(body);
    if (u.pathname.includes("/messages")) return { provider: "anthropic", operation: "chat", model: b.model ?? "unknown" };
    return null;
  },
  parseJson(j) {
    const u = j?.usage ?? {};
    const tokens: Partial<TokenUsage> = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
    };
    if (typeof u.cache_read_input_tokens === "number") tokens.cachedInput = u.cache_read_input_tokens;
    return {
      model: j?.model,
      tokens,
      completion: Array.isArray(j?.content)
        ? j.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("")
        : undefined,
    };
  },
  parseStreamChunk(ev, acc) {
    if (ev?.type === "message_start" && ev.message) {
      if (ev.message.model) acc.model = ev.message.model;
      if (ev.message.usage) {
        acc.tokens = {
          ...(acc.tokens ?? {}),
          input: ev.message.usage.input_tokens ?? acc.tokens?.input ?? 0,
        };
        if (typeof ev.message.usage.cache_read_input_tokens === "number") {
          acc.tokens.cachedInput = ev.message.usage.cache_read_input_tokens;
        }
      }
    } else if (ev?.type === "content_block_delta" && typeof ev.delta?.text === "string") {
      acc.completion = (acc.completion ?? "") + ev.delta.text;
    } else if (ev?.type === "message_delta" && typeof ev.usage?.output_tokens === "number") {
      acc.tokens = { ...(acc.tokens ?? {}), output: ev.usage.output_tokens };
    }
  },
  isStreaming: (body) => json(body).stream === true,
};

// ---------------- Google Generative AI ---------------- //

const googleParser: FetchParser = {
  matches: (u) => /generativelanguage\.googleapis\.com$/.test(u.hostname),
  detect(u) {
    // /v1beta/models/gemini-1.5-pro:generateContent  (or :streamGenerateContent, :embedContent)
    const m = /\/models\/([^:/]+):([a-zA-Z]+)/.exec(u.pathname);
    if (!m) return null;
    const model = m[1]!;
    const action = m[2]!;
    if (action.startsWith("embed")) return { provider: "google", operation: "embedding", model };
    return { provider: "google", operation: "chat", model };
  },
  parseJson(j) {
    const u = j?.usageMetadata ?? {};
    const tokens: Partial<TokenUsage> = {
      input: u.promptTokenCount ?? 0,
      output: u.candidatesTokenCount ?? 0,
    };
    if (typeof u.cachedContentTokenCount === "number") tokens.cachedInput = u.cachedContentTokenCount;
    if (typeof u.thoughtsTokenCount === "number") tokens.reasoning = u.thoughtsTokenCount;
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("");
    return { tokens, completion: text };
  },
  parseStreamChunk(ev, acc) {
    if (ev?.usageMetadata) {
      acc.tokens = {
        ...(acc.tokens ?? {}),
        input: ev.usageMetadata.promptTokenCount ?? acc.tokens?.input ?? 0,
        output: ev.usageMetadata.candidatesTokenCount ?? acc.tokens?.output ?? 0,
      };
    }
    const text = ev?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("");
    if (text) acc.completion = (acc.completion ?? "") + text;
  },
  isStreaming: (_body, _res) => false, // Google uses :streamGenerateContent path; we infer below
};

// ---------------- Mistral ---------------- //

const mistralParser: FetchParser = {
  matches: (u) => u.hostname === "api.mistral.ai",
  detect(u, body) {
    const b = json(body);
    if (u.pathname.includes("/chat/completions")) return { provider: "mistral", operation: "chat", model: b.model ?? "unknown" };
    if (u.pathname.includes("/embeddings")) return { provider: "mistral", operation: "embedding", model: b.model ?? "unknown" };
    if (u.pathname.includes("/fim/completions")) return { provider: "mistral", operation: "completion", model: b.model ?? "unknown" };
    return null;
  },
  parseJson(j) {
    const u = j?.usage ?? {};
    return {
      model: j?.model,
      tokens: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 },
      completion: j?.choices?.[0]?.message?.content,
    };
  },
  parseStreamChunk(ev, acc) {
    if (ev?.model) acc.model = ev.model;
    if (ev?.usage) {
      acc.tokens = {
        ...(acc.tokens ?? {}),
        input: ev.usage.prompt_tokens ?? acc.tokens?.input ?? 0,
        output: ev.usage.completion_tokens ?? acc.tokens?.output ?? 0,
      };
    }
    const delta = ev?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") acc.completion = (acc.completion ?? "") + delta;
  },
  isStreaming: (body) => json(body).stream === true,
};

// ---------------- Groq, OpenRouter, xAI (OpenAI-compatible) ---------------- //

function makeOpenAICompatible(name: ProviderName, hostRe: RegExp): FetchParser {
  return {
    matches: (u) => hostRe.test(u.hostname),
    detect(u, body) {
      const b = json(body);
      if (u.pathname.includes("/chat/completions")) return { provider: name, operation: "chat", model: b.model ?? "unknown" };
      if (u.pathname.includes("/completions")) return { provider: name, operation: "completion", model: b.model ?? "unknown" };
      if (u.pathname.includes("/embeddings")) return { provider: name, operation: "embedding", model: b.model ?? "unknown" };
      return null;
    },
    parseJson: openaiParser.parseJson,
    parseStreamChunk: openaiParser.parseStreamChunk,
    isStreaming: (body) => json(body).stream === true,
  };
}

const groqParser = makeOpenAICompatible("groq", /(?:^|\.)api\.groq\.com$/);
const openrouterParser = makeOpenAICompatible("openrouter", /openrouter\.ai$/);
const xaiParser = makeOpenAICompatible("xai", /(?:^|\.)api\.x\.ai$/);

// ---------------- Ollama ---------------- //

const ollamaParser: FetchParser = {
  matches: (u) => /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(u.hostname) && u.pathname.startsWith("/api/"),
  detect(u, body) {
    const b = json(body);
    if (u.pathname.endsWith("/chat")) return { provider: "ollama", operation: "chat", model: b.model ?? "unknown" };
    if (u.pathname.endsWith("/generate")) return { provider: "ollama", operation: "completion", model: b.model ?? "unknown" };
    if (u.pathname.endsWith("/embeddings") || u.pathname.endsWith("/embed"))
      return { provider: "ollama", operation: "embedding", model: b.model ?? "unknown" };
    return null;
  },
  parseJson(j) {
    return {
      model: j?.model,
      tokens: {
        input: j?.prompt_eval_count ?? 0,
        output: j?.eval_count ?? 0,
      },
      completion: j?.message?.content ?? j?.response,
    };
  },
  parseStreamChunk(ev, acc) {
    if (ev?.model) acc.model = ev.model;
    if (ev?.done) {
      acc.tokens = {
        input: ev.prompt_eval_count ?? acc.tokens?.input ?? 0,
        output: ev.eval_count ?? acc.tokens?.output ?? 0,
      };
    }
    const piece = ev?.message?.content ?? ev?.response;
    if (typeof piece === "string") acc.completion = (acc.completion ?? "") + piece;
  },
  isStreaming: (body) => json(body).stream !== false, // Ollama defaults to streaming
};

export const PARSERS: FetchParser[] = [
  openaiParser,
  anthropicParser,
  googleParser,
  mistralParser,
  groqParser,
  openrouterParser,
  xaiParser,
  ollamaParser,
];

export function findParser(url: URL): FetchParser | null {
  return PARSERS.find((p) => p.matches(url)) ?? null;
}

/** Best-effort: is this response a server-sent-events stream? */
export function looksLikeSse(url: URL, body: unknown, response: Response): boolean {
  const ct = response.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) return true;
  if (url.pathname.includes(":streamGenerateContent")) return true; // Google
  const parser = findParser(url);
  if (parser?.isStreaming?.(body, response)) return true;
  return false;
}
