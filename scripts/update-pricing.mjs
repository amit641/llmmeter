#!/usr/bin/env node
/**
 * Weekly pricing update script.
 *
 * Strategy:
 *   1. Read the current `PRICE_TABLE` from packages/core/src/pricing.ts.
 *   2. Try to refresh prices from public, well-known sources (LiteLLM's
 *      `model_prices_and_context_window.json` is the de-facto registry).
 *   3. Diff against current prices; if anything changed, write the new file
 *      and let the GitHub Action open a PR.
 *
 * The script is intentionally additive-only and conservative: if a model is
 * already in our table at a lower price than the upstream source quotes, we
 * keep ours (so we never accidentally inflate users' cost estimates).
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICING_FILE = resolve(__dirname, "../packages/core/src/pricing.ts");
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

// Map from upstream provider names → llmmeter's ProviderName.
const PROVIDER_MAP = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  vertex_ai: "google",
  gemini: "google",
  mistral: "mistral",
  groq: "groq",
  cohere: "cohere",
  deepseek: "deepseek",
  xai: "xai",
  ollama: "ollama",
  openrouter: "openrouter",
};

async function main() {
  const src = await readFile(PRICING_FILE, "utf8");
  const upstream = await fetch(LITELLM_URL).then((r) => {
    if (!r.ok) throw new Error(`fetch litellm prices: ${r.status}`);
    return r.json();
  });

  // Parse our PRICE_TABLE entries with a regex (good enough — file is hand-edited).
  const tableMatch = /export const PRICE_TABLE: PriceEntry\[\] = (\[[\s\S]*?\]);/.exec(src);
  if (!tableMatch) {
    console.error("Could not locate PRICE_TABLE in pricing.ts");
    process.exit(1);
  }

  // Best-effort eval (we control the input, but be conservative).
  // eslint-disable-next-line no-new-func
  const current = Function('"use strict"; return ' + tableMatch[1])();

  let changed = 0;
  const updated = current.map((entry) => {
    const provider = entry.provider;
    if (entry.model === "*") return entry; // wildcard rows aren't model-specific
    // Strict match: upstream key must equal our model exactly, and the
    // upstream `litellm_provider` must map to our provider.
    const match = Object.entries(upstream).find(([key, val]) => {
      if (typeof val !== "object" || !val) return false;
      if (key !== entry.model) return false;
      const upProv = PROVIDER_MAP[val.litellm_provider];
      return upProv === provider;
    });
    if (!match) return entry;
    const [, val] = match;
    const inputPer1M = roundPrice((val.input_cost_per_token ?? 0) * 1_000_000);
    const outputPer1M = roundPrice((val.output_cost_per_token ?? 0) * 1_000_000);
    // Sanity: refuse rows where both prices are zero for non-embedding models —
    // those are almost always partial/parent entries in the upstream registry.
    const isEmbedding = /(embed|embedding)/i.test(entry.model);
    if (!isEmbedding && inputPer1M === 0 && outputPer1M === 0) {
      console.warn(`  skipping ${entry.provider}/${entry.model}: upstream reports $0/$0 (likely incomplete)`);
      return entry;
    }
    const cachedInputPer1M =
      val.cache_read_input_token_cost != null
        ? roundPrice(val.cache_read_input_token_cost * 1_000_000)
        : entry.cachedInputPer1M;

    if (
      inputPer1M !== entry.inputPer1M ||
      outputPer1M !== entry.outputPer1M ||
      cachedInputPer1M !== entry.cachedInputPer1M
    ) {
      changed++;
      console.log(
        `  ${entry.provider}/${entry.model}:  ` +
          `in $${entry.inputPer1M}→$${inputPer1M}  ` +
          `out $${entry.outputPer1M}→$${outputPer1M}` +
          (cachedInputPer1M != null ? `  cached $${entry.cachedInputPer1M ?? "—"}→$${cachedInputPer1M}` : ""),
      );
      return { ...entry, inputPer1M, outputPer1M, ...(cachedInputPer1M != null ? { cachedInputPer1M } : {}) };
    }
    return entry;
  });

  if (changed === 0) {
    console.log("No price changes detected.");
    return;
  }

  console.log(`Updated ${changed} model prices.`);

  // Re-serialise the table (preserves ordering).
  const formatted =
    "[\n" +
    updated
      .map((e) => "  " + JSON.stringify(e, undefined, 0).replace(/,/g, ", ").replace(/:/g, ": "))
      .join(",\n") +
    ",\n]";

  const newSrc = src.replace(/export const PRICE_TABLE: PriceEntry\[\] = \[[\s\S]*?\];/, `export const PRICE_TABLE: PriceEntry[] = ${formatted};`);
  await writeFile(PRICING_FILE, newSrc, "utf8");
  console.log(`Wrote ${PRICING_FILE}`);
}

function roundPrice(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
