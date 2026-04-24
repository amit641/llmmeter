/**
 * Public types for llmmeter. Adapters convert provider responses to LLMCallRecord;
 * sinks consume LLMCallRecord. Nothing else in the system needs to know about
 * provider specifics.
 */

export type ProviderName =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "groq"
  | "cohere"
  | "deepseek"
  | "openrouter"
  | "xai"
  | "ollama"
  | "custom";

export type Operation =
  | "chat"
  | "completion"
  | "embedding"
  | "image"
  | "audio"
  | "moderation"
  | "tool";

export type CallStatus = "ok" | "error" | "cancelled";

export interface TokenUsage {
  input: number;
  output: number;
  cachedInput?: number;
  reasoning?: number;
  total?: number;
}

export interface LLMCallRecord {
  /** ULID, generated locally. */
  id: string;
  /** Groups multiple calls in the same logical operation (e.g. tool-call loop). */
  traceId: string;
  /** Optional parent record id for nested calls. */
  parentId?: string;
  /** Unix epoch ms when the call started. */
  ts: number;
  provider: ProviderName;
  model: string;
  operation: Operation;
  /** End-to-end duration in ms. */
  durationMs: number;
  /** Time-to-first-token for streaming responses. */
  ttftMs?: number;
  tokens: TokenUsage;
  /** USD cost. `null` means we couldn't resolve a price for this model. */
  costUsd: number | null;
  status: CallStatus;
  errorClass?: string;
  errorMessage?: string;
  retryCount?: number;

  // ---- User-supplied context ----
  userId?: string;
  feature?: string;
  conversationId?: string;
  meta?: Record<string, string | number | boolean>;

  // ---- Payload (gated by sampling + redaction) ----
  /** SHA-256 of the prompt content; always recorded for grouping. */
  promptHash: string;
  /** Recorded only if `recordPayload: true` on the meter (default: off). */
  prompt?: unknown;
  completion?: unknown;
}

export type RecordWithoutId = Omit<LLMCallRecord, "id">;

/**
 * A sink consumes records. Implementations: SQLite, HTTP, Postgres, OTel, JSONL.
 * `flush()` MUST resolve when all in-memory records are durably persisted.
 * `close()` should call flush internally.
 */
export interface Sink {
  /** Friendly name for diagnostics. */
  readonly name: string;
  /** Push a single record. Implementations are expected to batch internally. */
  write(record: LLMCallRecord): void | Promise<void>;
  /** Force any buffered records to be persisted. */
  flush(): Promise<void>;
  /** Release resources (DB handles, intervals). */
  close(): Promise<void>;
}

export interface MeterContext {
  traceId?: string;
  parentId?: string;
  userId?: string;
  feature?: string;
  conversationId?: string;
  meta?: Record<string, string | number | boolean>;
}

/** Options accepted by `meter(client, options)`. */
export interface MeterOptions extends MeterContext {
  /** Sink to write to. Defaults to a JSONL file under `./.llmmeter/` if unset. */
  sink?: Sink;
  /** Record full prompt + completion bodies. Off by default for privacy. */
  recordPayload?: boolean;
  /** Sampling: 0..1 (fraction of records to record full payloads for). */
  payloadSampleRate?: number;
  /** Hard daily spend cap in USD. */
  maxDailySpendUsd?: number;
  /** Behavior when daily cap is hit. */
  onBudgetExceeded?: "warn" | "throw";
  /** Custom redactor; defaults to a sane regex-based one. */
  redact?: (value: unknown) => unknown;
}
