import type { LLMCallRecord, Sink } from "../types.js";

export interface HttpSinkOptions {
  /** Collector URL, e.g. https://llmmeter.your-domain.com/ingest */
  url: string;
  /** Optional bearer token; sent as `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
  /** Extra headers to merge in. */
  headers?: Record<string, string>;
  /** Records per HTTP request. Defaults to 50. */
  batchSize?: number;
  /** Flush interval in ms. Defaults to 2000. */
  flushIntervalMs?: number;
  /** Max records buffered before older ones are dropped. Defaults to 5000. */
  maxBufferSize?: number;
  /** Max retry attempts per batch. Defaults to 4. */
  maxRetries?: number;
  /** Request timeout in ms. Defaults to 5000. */
  timeoutMs?: number;
  /** Provide a custom fetch (e.g. for tests). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Edge-compatible HTTP sink. Pure `fetch`, no Node-specific APIs.
 * Batches with size + interval triggers, retries with exponential backoff + jitter,
 * bounded buffer (drops oldest on overflow). Never throws to the caller.
 */
export function httpSink(opts: HttpSinkOptions): Sink {
  const url = opts.url;
  if (!url) throw new Error("[llmmeter] httpSink requires a `url`.");

  const batchSize = opts.batchSize ?? 50;
  const flushIntervalMs = opts.flushIntervalMs ?? 2000;
  const maxBufferSize = opts.maxBufferSize ?? 5000;
  const maxRetries = opts.maxRetries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("[llmmeter] httpSink: no fetch available. Pass `fetch` in options.");
  }

  let buffer: LLMCallRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> = Promise.resolve();
  let droppedCount = 0;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    ...opts.headers,
  };

  const sendBatch = async (batch: LLMCallRecord[]) => {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= maxRetries) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ records: batch }),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (res.ok) return;
        // Non-2xx: retry on 5xx and 429 only
        if (res.status < 500 && res.status !== 429) {
          // eslint-disable-next-line no-console
          console.warn(`[llmmeter] httpSink: server rejected batch (${res.status}); dropping.`);
          return;
        }
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err) {
        clearTimeout(t);
        lastErr = err;
      }
      attempt++;
      const backoff = Math.min(30_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoff));
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[llmmeter] httpSink: gave up on batch of ${batch.length} after ${maxRetries} retries:`,
      (lastErr as Error)?.message,
    );
  };

  const doFlush = async () => {
    while (buffer.length > 0) {
      const batch = buffer.splice(0, batchSize);
      await sendBatch(batch);
    }
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      pending = pending.then(doFlush);
    }, flushIntervalMs);
    (timer as { unref?: () => void }).unref?.();
  };

  return {
    name: "http",
    write(record) {
      buffer.push(record);
      if (buffer.length > maxBufferSize) {
        const overflow = buffer.length - maxBufferSize;
        buffer.splice(0, overflow);
        droppedCount += overflow;
        if (droppedCount % 100 === 0) {
          // eslint-disable-next-line no-console
          console.warn(`[llmmeter] httpSink: buffer overflow, dropped ${droppedCount} records total`);
        }
      }
      if (buffer.length >= batchSize) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        pending = pending.then(doFlush);
      } else {
        scheduleFlush();
      }
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = pending.then(doFlush);
      await pending;
    },
    async close() {
      await this.flush();
    },
  };
}
