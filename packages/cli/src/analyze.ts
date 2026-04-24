/**
 * Smart routing suggestions.
 *
 * The idea: most apps over-pay because every request goes to the strongest
 * model in their provider. We group historical calls by promptHash + model,
 * then for each (feature × promptHash) cluster compute:
 *
 *   - Which models the prompt was actually run against
 *   - Whether a cheaper model handled it without errors
 *   - The potential monthly savings if you'd routed all of those calls to
 *     the cheaper model
 *
 * This is a heuristic — production teams should still A/B before flipping —
 * but it surfaces obvious wins ("80% of /support traffic could go to
 * gpt-4o-mini at 1/15th the cost") without any extra instrumentation.
 */

import { PRICE_TABLE, priceFor, type ProviderName } from "@llmmeter/core";
import type { Storage, QueryFilters } from "./storage.js";

export interface RoutingSuggestion {
  feature: string;
  fromModel: string;
  fromProvider: ProviderName;
  toModel: string;
  toProvider: ProviderName;
  /** Number of historical calls in scope. */
  callCount: number;
  /** Average input/output tokens used to estimate savings. */
  avgInputTokens: number;
  avgOutputTokens: number;
  /** Per-call cost: current model. */
  currentCostPerCall: number;
  /** Per-call cost if rerouted. */
  candidateCostPerCall: number;
  /** Total $ saved across the analysed window if rerouted. */
  savedUsd: number;
  /** Confidence 0..1 — based on success rate of the candidate model. */
  confidence: number;
  reason: string;
}

export interface AnalyzeOptions {
  storage: Storage;
  /** Only analyze calls newer than this. Defaults to 14 days. */
  sinceMs?: number;
  /** Minimum number of calls in a (feature, prompt_hash) cluster to be considered. */
  minClusterSize?: number;
  /** Minimum success rate required of the candidate model. */
  minConfidence?: number;
  /** Optional filters (feature, provider, etc). */
  filters?: QueryFilters;
}

interface CallRow {
  feature: string | null;
  provider: string;
  model: string;
  operation: string;
  prompt_hash: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  status: string;
}

/**
 * Heuristic: which models in the price table are valid replacements for the
 * given operation. We don't want to recommend an embedding model as a
 * replacement for a chat model.
 */
const EMBEDDING_RE = /(embed|embedding)/i;
const REASONING_RE = /^(o1|o3|o4|gpt-5|claude-3.5-sonnet-thinking)/i;
function modelKindFor(operation: string, model: string): "embedding" | "reasoning-chat" | "chat" | "other" {
  if (operation === "embedding" || EMBEDDING_RE.test(model)) return "embedding";
  if (operation === "chat") {
    return REASONING_RE.test(model) ? "reasoning-chat" : "chat";
  }
  return "other";
}
function compatibleKinds(currentKind: ReturnType<typeof modelKindFor>): Set<ReturnType<typeof modelKindFor>> {
  if (currentKind === "embedding") return new Set(["embedding"]);
  // Both reasoning and regular chat models can replace each other (a "downgrade"
  // from reasoning → chat is the most common cost-savings move).
  if (currentKind === "chat" || currentKind === "reasoning-chat") return new Set(["chat", "reasoning-chat"]);
  return new Set([currentKind]);
}

export async function analyzeRouting(opts: AnalyzeOptions): Promise<RoutingSuggestion[]> {
  const since = opts.sinceMs ?? 14 * 24 * 3_600_000;
  const minCluster = opts.minClusterSize ?? 5;
  const minConfidence = opts.minConfidence ?? 0.95;
  const fromTs = Date.now() - since;

  const rows = (await opts.storage.listCalls({
    ...opts.filters,
    fromTs,
    limit: 100_000,
  })) as CallRow[];

  // Bucket by (feature, operation, prompt_hash) → per-model stats. We key on
  // operation too so we never cross-suggest (e.g. embedding ↔ chat).
  type ModelStats = {
    model: string;
    provider: ProviderName;
    calls: number;
    errors: number;
    sumInput: number;
    sumOutput: number;
  };
  const clusters = new Map<string, Map<string, ModelStats>>();
  for (const r of rows) {
    const feature = r.feature ?? "(no-feature)";
    const cluster = `${feature}|${r.operation ?? "chat"}|${r.prompt_hash}`;
    let perModel = clusters.get(cluster);
    if (!perModel) {
      perModel = new Map();
      clusters.set(cluster, perModel);
    }
    let s = perModel.get(r.model);
    if (!s) {
      s = {
        model: r.model,
        provider: r.provider as ProviderName,
        calls: 0,
        errors: 0,
        sumInput: 0,
        sumOutput: 0,
      };
      perModel.set(r.model, s);
    }
    s.calls++;
    if (r.status === "error") s.errors++;
    s.sumInput += r.input_tokens;
    s.sumOutput += r.output_tokens;
  }

  // For each cluster, find the cheapest model that has good success rate
  // and at least some history. Compare against the most expensive model
  // currently handling that cluster.
  const suggestionsByPair = new Map<string, RoutingSuggestion>();

  for (const [clusterKey, models] of clusters) {
    if (models.size === 0) continue;
    const total = Array.from(models.values()).reduce((a, b) => a + b.calls, 0);
    if (total < minCluster) continue;

    // Avg tokens for this cluster.
    const sumIn = Array.from(models.values()).reduce((a, b) => a + b.sumInput, 0);
    const sumOut = Array.from(models.values()).reduce((a, b) => a + b.sumOutput, 0);
    const avgInput = sumIn / total;
    const avgOutput = sumOut / total;

    const scored = Array.from(models.values()).map((m) => {
      const cost = priceFor(m.provider, m.model, { input: Math.round(avgInput), output: Math.round(avgOutput) });
      const successRate = m.calls === 0 ? 0 : 1 - m.errors / m.calls;
      return { ...m, costPerCall: cost ?? Number.POSITIVE_INFINITY, successRate };
    });

    // The "current" model = the most expensive one actually being used.
    const current = scored.reduce((a, b) => (a.costPerCall > b.costPerCall ? a : b));

    // Candidate: the cheapest model with calls > 0 and high success.
    const viableCandidates = scored.filter(
      (m) =>
        m.model !== current.model &&
        m.successRate >= minConfidence &&
        m.calls >= 2 &&
        m.costPerCall < current.costPerCall,
    );
    if (viableCandidates.length === 0) continue;
    const cheapest = viableCandidates.reduce((a, b) => (a.costPerCall < b.costPerCall ? a : b));
    if (current.costPerCall === Number.POSITIVE_INFINITY || cheapest.costPerCall === Number.POSITIVE_INFINITY) continue;

    // Aggregate by (feature, fromModel→toModel) so we don't list every prompt hash.
    const feature = clusterKey.split("|")[0]!;
    const pairKey = `${feature}|${current.model}|${cheapest.model}`;
    const callsAtCurrent = current.calls; // only re-route calls currently going to the expensive one
    const saved = (current.costPerCall - cheapest.costPerCall) * callsAtCurrent;

    const existing = suggestionsByPair.get(pairKey);
    if (existing) {
      existing.callCount += callsAtCurrent;
      existing.avgInputTokens = (existing.avgInputTokens + avgInput) / 2;
      existing.avgOutputTokens = (existing.avgOutputTokens + avgOutput) / 2;
      existing.savedUsd += saved;
      existing.confidence = Math.min(existing.confidence, cheapest.successRate);
    } else {
      suggestionsByPair.set(pairKey, {
        feature,
        fromModel: current.model,
        fromProvider: current.provider,
        toModel: cheapest.model,
        toProvider: cheapest.provider,
        callCount: callsAtCurrent,
        avgInputTokens: avgInput,
        avgOutputTokens: avgOutput,
        currentCostPerCall: current.costPerCall,
        candidateCostPerCall: cheapest.costPerCall,
        savedUsd: saved,
        confidence: cheapest.successRate,
        reason: `${cheapest.calls} historical calls handled the same prompt at ${(((current.costPerCall - cheapest.costPerCall) / current.costPerCall) * 100).toFixed(0)}% lower cost with ${(cheapest.successRate * 100).toFixed(1)}% success.`,
      });
    }
  }

  return Array.from(suggestionsByPair.values()).sort((a, b) => b.savedUsd - a.savedUsd);
}

/**
 * Even when we have no overlap between models within a feature, we can suggest
 * candidates by checking whether the cheapest model in the same provider family
 * could have handled the workload (the user just never tried it). This is more
 * speculative and labelled as "untested".
 */
export interface UntestedSuggestion {
  feature: string;
  fromModel: string;
  fromProvider: ProviderName;
  candidateModel: string;
  candidateProvider: ProviderName;
  callCount: number;
  estimatedSavedUsd: number;
  reason: string;
}

export async function suggestUntestedAlternatives(opts: AnalyzeOptions): Promise<UntestedSuggestion[]> {
  const since = opts.sinceMs ?? 14 * 24 * 3_600_000;
  const fromTs = Date.now() - since;
  const rows = (await opts.storage.listCalls({
    ...opts.filters,
    fromTs,
    limit: 100_000,
  })) as CallRow[];

  type FeatureModel = {
    feature: string;
    provider: ProviderName;
    model: string;
    operation: string;
    calls: number;
    sumInput: number;
    sumOutput: number;
    sumCost: number;
  };
  const map = new Map<string, FeatureModel>();
  for (const r of rows) {
    if (r.status === "error") continue;
    const key = `${r.feature ?? "(no-feature)"}|${r.provider}|${r.model}`;
    let s = map.get(key);
    if (!s) {
      s = {
        feature: r.feature ?? "(no-feature)",
        provider: r.provider as ProviderName,
        model: r.model,
        operation: r.operation ?? "chat",
        calls: 0,
        sumInput: 0,
        sumOutput: 0,
        sumCost: 0,
      };
      map.set(key, s);
    }
    s.calls++;
    s.sumInput += r.input_tokens;
    s.sumOutput += r.output_tokens;
    s.sumCost += r.cost_usd ?? 0;
  }

  const out: UntestedSuggestion[] = [];
  for (const fm of map.values()) {
    if (fm.calls < 10) continue;
    const avgIn = Math.round(fm.sumInput / fm.calls);
    const avgOut = Math.round(fm.sumOutput / fm.calls);
    const currentCost = priceFor(fm.provider, fm.model, { input: avgIn, output: avgOut });
    if (currentCost == null) continue;

    // Look at the bundled price table for cheaper models in the same provider
    // AND of a compatible kind (chat vs embedding).
    const currentKind = modelKindFor(fm.operation, fm.model);
    const allowed = compatibleKinds(currentKind);
    const candidates = PRICE_TABLE.filter(
      (p) => p.provider === fm.provider && p.model !== fm.model && allowed.has(modelKindFor(fm.operation, p.model)),
    );
    let best: { model: string; cost: number } | null = null;
    for (const cand of candidates) {
      const c = priceFor(fm.provider, cand.model, { input: avgIn, output: avgOut });
      if (c == null) continue;
      if (c < currentCost && (!best || c < best.cost)) {
        best = { model: cand.model, cost: c };
      }
    }
    if (!best) continue;
    const saved = (currentCost - best.cost) * fm.calls;
    if (saved <= 0) continue;
    out.push({
      feature: fm.feature,
      fromModel: fm.model,
      fromProvider: fm.provider,
      candidateModel: best.model,
      candidateProvider: fm.provider,
      callCount: fm.calls,
      estimatedSavedUsd: saved,
      reason: `Same-provider model ${best.model} costs ${(((currentCost - best.cost) / currentCost) * 100).toFixed(0)}% less for the avg request profile (${avgIn} in / ${avgOut} out tokens). No historical traffic against it — A/B before switching.`,
    });
  }

  return out.sort((a, b) => b.estimatedSavedUsd - a.estimatedSavedUsd);
}
