/**
 * Hand-curated initial price table. Prices in USD per 1M tokens.
 *
 * Source-of-truth for cost calculation. Update via `scripts/update-pricing.ts`,
 * which opens a PR with diffs versus provider docs.
 *
 * Matching rules (in order):
 *   1) exact provider+model
 *   2) provider + model with version suffix stripped (e.g. "gpt-4o-2024-08-06" -> "gpt-4o")
 *   3) startsWith match within the same provider (longest first)
 */

import type { ProviderName, TokenUsage } from "./types.js";

export interface PriceEntry {
  provider: ProviderName;
  model: string;
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
  validFrom: string; // ISO date
}

export const PRICE_TABLE: PriceEntry[] = [
  {"provider": "openai", "model": "gpt-4o", "inputPer1M": 2.5, "outputPer1M": 10, "cachedInputPer1M": 1.25, "validFrom": "2024-10-01"},
  {"provider": "openai", "model": "gpt-4o-mini", "inputPer1M": 0.15, "outputPer1M": 0.6, "cachedInputPer1M": 0.075, "validFrom": "2024-07-18"},
  {"provider": "openai", "model": "gpt-4-turbo", "inputPer1M": 10, "outputPer1M": 30, "validFrom": "2024-04-09"},
  {"provider": "openai", "model": "gpt-4", "inputPer1M": 30, "outputPer1M": 60, "validFrom": "2023-06-13"},
  {"provider": "openai", "model": "gpt-3.5-turbo", "inputPer1M": 0.5, "outputPer1M": 1.5, "validFrom": "2024-01-25"},
  {"provider": "openai", "model": "o1", "inputPer1M": 15, "outputPer1M": 60, "cachedInputPer1M": 7.5, "validFrom": "2024-12-17"},
  {"provider": "openai", "model": "o1-mini", "inputPer1M": 1.21, "outputPer1M": 4.84, "cachedInputPer1M": 0.605, "validFrom": "2024-09-12"},
  {"provider": "openai", "model": "o3-mini", "inputPer1M": 1.1, "outputPer1M": 4.4, "cachedInputPer1M": 0.55, "validFrom": "2025-01-31"},
  {"provider": "openai", "model": "text-embedding-3-small", "inputPer1M": 0.02, "outputPer1M": 0, "validFrom": "2024-01-25"},
  {"provider": "openai", "model": "text-embedding-3-large", "inputPer1M": 0.13, "outputPer1M": 0, "validFrom": "2024-01-25"},
  {"provider": "openai", "model": "text-embedding-ada-002", "inputPer1M": 0.1, "outputPer1M": 0, "validFrom": "2022-12-15"},
  {"provider": "anthropic", "model": "claude-3-5-sonnet", "inputPer1M": 3, "outputPer1M": 15, "cachedInputPer1M": 0.3, "validFrom": "2024-06-20"},
  {"provider": "anthropic", "model": "claude-3-5-haiku", "inputPer1M": 0.8, "outputPer1M": 4, "cachedInputPer1M": 0.08, "validFrom": "2024-11-04"},
  {"provider": "anthropic", "model": "claude-3-opus", "inputPer1M": 15, "outputPer1M": 75, "cachedInputPer1M": 1.5, "validFrom": "2024-02-29"},
  {"provider": "anthropic", "model": "claude-3-sonnet", "inputPer1M": 3, "outputPer1M": 15, "validFrom": "2024-02-29"},
  {"provider": "anthropic", "model": "claude-3-haiku", "inputPer1M": 0.25, "outputPer1M": 1.25, "cachedInputPer1M": 0.03, "validFrom": "2024-03-13"},
  {"provider": "google", "model": "gemini-2.0-flash", "inputPer1M": 0.1, "outputPer1M": 0.4, "validFrom": "2025-02-05", "cachedInputPer1M": 0.025},
  {"provider": "google", "model": "gemini-1.5-pro", "inputPer1M": 1.25, "outputPer1M": 5, "cachedInputPer1M": 0.31, "validFrom": "2024-09-24"},
  {"provider": "google", "model": "gemini-1.5-flash", "inputPer1M": 0.075, "outputPer1M": 0.3, "cachedInputPer1M": 0.019, "validFrom": "2024-09-24"},
  {"provider": "google", "model": "gemini-1.5-flash-8b", "inputPer1M": 0.0375, "outputPer1M": 0.15, "validFrom": "2024-10-03"},
  {"provider": "google", "model": "text-embedding-004", "inputPer1M": 0, "outputPer1M": 0, "validFrom": "2024-04-01"},
  {"provider": "mistral", "model": "mistral-large", "inputPer1M": 4, "outputPer1M": 12, "validFrom": "2024-11-18"},
  {"provider": "mistral", "model": "mistral-small", "inputPer1M": 1, "outputPer1M": 3, "validFrom": "2024-09-17"},
  {"provider": "mistral", "model": "codestral", "inputPer1M": 0.3, "outputPer1M": 0.9, "validFrom": "2024-05-29"},
  {"provider": "mistral", "model": "mistral-embed", "inputPer1M": 0.1, "outputPer1M": 0, "validFrom": "2024-01-01"},
  {"provider": "groq", "model": "llama-3.3-70b-versatile", "inputPer1M": 0.59, "outputPer1M": 0.79, "validFrom": "2024-12-06"},
  {"provider": "groq", "model": "llama-3.1-8b-instant", "inputPer1M": 0.05, "outputPer1M": 0.08, "validFrom": "2024-07-23"},
  {"provider": "deepseek", "model": "deepseek-chat", "inputPer1M": 0.28, "outputPer1M": 0.42, "cachedInputPer1M": 0.028, "validFrom": "2024-12-26"},
  {"provider": "deepseek", "model": "deepseek-reasoner", "inputPer1M": 0.28, "outputPer1M": 0.42, "cachedInputPer1M": 0.028, "validFrom": "2025-01-20"},
  {"provider": "xai", "model": "grok-2", "inputPer1M": 2, "outputPer1M": 10, "validFrom": "2024-08-13"},
  {"provider": "xai", "model": "grok-2-mini", "inputPer1M": 0.2, "outputPer1M": 0.5, "validFrom": "2024-08-13"},
  {"provider": "ollama", "model": "*", "inputPer1M": 0, "outputPer1M": 0, "validFrom": "2023-01-01"},
];

const stripVersion = (m: string) => m.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-v?\d+(\.\d+)*$/, "");

function findEntry(provider: ProviderName, model: string): PriceEntry | undefined {
  const exact = PRICE_TABLE.find((p) => p.provider === provider && p.model === model);
  if (exact) return exact;

  const stripped = stripVersion(model);
  const stripExact = PRICE_TABLE.find((p) => p.provider === provider && p.model === stripped);
  if (stripExact) return stripExact;

  // longest startsWith
  const candidates = PRICE_TABLE.filter(
    (p) => p.provider === provider && (model.startsWith(p.model) || stripped.startsWith(p.model)),
  ).sort((a, b) => b.model.length - a.model.length);
  if (candidates[0]) return candidates[0];

  // wildcard
  return PRICE_TABLE.find((p) => p.provider === provider && p.model === "*");
}

/** Returns USD cost, or null if the model is unknown. */
export function priceFor(provider: ProviderName, model: string, tokens: TokenUsage): number | null {
  const entry = findEntry(provider, model);
  if (!entry) return null;
  const cached = tokens.cachedInput ?? 0;
  const freshInput = Math.max(0, tokens.input - cached);
  const cachedRate = entry.cachedInputPer1M ?? entry.inputPer1M;
  const cost =
    (freshInput * entry.inputPer1M) / 1_000_000 +
    (cached * cachedRate) / 1_000_000 +
    (tokens.output * entry.outputPer1M) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000; // round to 6 dp
}
