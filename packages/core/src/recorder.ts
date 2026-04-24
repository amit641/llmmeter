/**
 * The central recorder. Adapters call `recorder.start(...)` when a call begins
 * and `recorder.finish(...)` (or `.fail(...)`) when it ends. Streaming adapters
 * call `.firstToken()` once.
 *
 * The recorder owns: id generation, context resolution, redaction, payload
 * sampling, pricing, budget enforcement, and dispatch to the sink.
 *
 * It NEVER throws to the caller (except BudgetExceededError when configured).
 */

import { BudgetExceededError, recordSpend, spendToday } from "./budget.js";
import { resolveContext } from "./context.js";
import { defaultRedact, hashPrompt } from "./redact.js";
import { priceFor } from "./pricing.js";
import type {
  LLMCallRecord,
  MeterContext,
  MeterOptions,
  Operation,
  ProviderName,
  Sink,
  TokenUsage,
} from "./types.js";
import { ulid } from "./ulid.js";

export interface ResolvedMeter {
  sink: Sink;
  options: MeterOptions;
}

export interface CallStart {
  id: string;
  traceId: string;
  ts: number;
  ttftMs?: number;
  retryCount: number;
  context: MeterContext;
  promptHashPromise: Promise<string>;
  prompt: unknown;
}

export interface FinishParams {
  provider: ProviderName;
  model: string;
  operation: Operation;
  tokens: TokenUsage;
  completion?: unknown;
  retryCount?: number;
}

export interface FailParams {
  provider: ProviderName;
  model: string;
  operation: Operation;
  errorClass: string;
  errorMessage?: string;
  tokens?: TokenUsage;
  retryCount?: number;
}

export class Recorder {
  constructor(private readonly meter: ResolvedMeter) {}

  start(params: { prompt: unknown; callContext?: MeterContext }): CallStart {
    const id = ulid();
    const ctx = resolveContext(params.callContext ?? {}, id);
    return {
      id,
      traceId: ctx.traceId ?? id,
      ts: Date.now(),
      retryCount: 0,
      context: ctx,
      promptHashPromise: hashPrompt(params.prompt).catch(() => "unhashable"),
      prompt: params.prompt,
    };
  }

  firstToken(start: CallStart): void {
    if (start.ttftMs == null) start.ttftMs = Date.now() - start.ts;
  }

  async finish(start: CallStart, params: FinishParams): Promise<LLMCallRecord> {
    const cost = priceFor(params.provider, params.model, params.tokens);
    const record = await this.toRecord(start, "ok", {
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      tokens: params.tokens,
      cost,
      completion: params.completion,
      retryCount: params.retryCount ?? start.retryCount,
    });
    this.dispatch(record);
    if (cost != null) this.enforceBudget(cost);
    return record;
  }

  async fail(start: CallStart, params: FailParams): Promise<LLMCallRecord> {
    const tokens = params.tokens ?? { input: 0, output: 0 };
    const cost = priceFor(params.provider, params.model, tokens);
    const record = await this.toRecord(start, "error", {
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      tokens,
      cost,
      retryCount: params.retryCount ?? start.retryCount,
      errorClass: params.errorClass,
      errorMessage: params.errorMessage,
    });
    this.dispatch(record);
    return record;
  }

  private enforceBudget(addedUsd: number) {
    const cap = this.meter.options.maxDailySpendUsd;
    if (cap == null) return;
    recordSpend(addedUsd);
    if (spendToday() > cap) {
      if (this.meter.options.onBudgetExceeded === "throw") {
        throw new BudgetExceededError(cap, spendToday());
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[llmmeter] daily spend cap exceeded: $${spendToday().toFixed(4)} > $${cap.toFixed(2)}`,
      );
    }
  }

  private dispatch(record: LLMCallRecord): void {
    // Hand off to sink in a microtask so the user's await isn't blocked.
    queueMicrotask(() => {
      try {
        const maybe = this.meter.sink.write(record);
        if (maybe && typeof (maybe as Promise<void>).catch === "function") {
          (maybe as Promise<void>).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(`[llmmeter] sink "${this.meter.sink.name}" write failed:`, err?.message ?? err);
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[llmmeter] sink "${this.meter.sink.name}" write threw:`, (err as Error).message);
      }
    });
  }

  private async toRecord(
    start: CallStart,
    status: "ok" | "error",
    extras: {
      provider: ProviderName;
      model: string;
      operation: Operation;
      tokens: TokenUsage;
      cost: number | null;
      completion?: unknown;
      retryCount?: number;
      errorClass?: string;
      errorMessage?: string;
    },
  ): Promise<LLMCallRecord> {
    const promptHash = await start.promptHashPromise;
    const recordPayload = this.shouldRecordPayload();
    const redactor = this.meter.options.redact ?? defaultRedact;

    const tokens: TokenUsage = {
      ...extras.tokens,
      total:
        extras.tokens.total ??
        extras.tokens.input + extras.tokens.output + (extras.tokens.reasoning ?? 0),
    };

    const record: LLMCallRecord = {
      id: start.id,
      traceId: start.traceId,
      parentId: start.context.parentId,
      ts: start.ts,
      provider: extras.provider,
      model: extras.model,
      operation: extras.operation,
      durationMs: Date.now() - start.ts,
      ttftMs: start.ttftMs,
      tokens,
      costUsd: extras.cost,
      status,
      errorClass: extras.errorClass,
      errorMessage: extras.errorMessage,
      retryCount: extras.retryCount,
      userId: start.context.userId,
      feature: start.context.feature,
      conversationId: start.context.conversationId,
      meta: start.context.meta && Object.keys(start.context.meta).length ? start.context.meta : undefined,
      promptHash,
      prompt: recordPayload ? redactor(start.prompt) : undefined,
      completion: recordPayload ? redactor(extras.completion) : undefined,
    };
    return record;
  }

  private shouldRecordPayload(): boolean {
    if (!this.meter.options.recordPayload) return false;
    const rate = this.meter.options.payloadSampleRate ?? 1;
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    return Math.random() < rate;
  }
}
