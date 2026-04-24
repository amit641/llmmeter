import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { LLMCallRecord, Sink } from "../types.js";

export interface JsonlSinkOptions {
  filePath?: string;
  flushIntervalMs?: number;
  maxBufferSize?: number;
}

/**
 * Append-only JSONL sink. Default fallback when no sink is configured.
 * Cheap, durable, easy to ship somewhere else later (e.g. S3, Loki).
 */
export function jsonlSink(opts: JsonlSinkOptions = {}): Sink {
  const filePath = opts.filePath ?? "./.llmmeter/calls.jsonl";
  const flushIntervalMs = opts.flushIntervalMs ?? 1000;
  const maxBufferSize = opts.maxBufferSize ?? 200;

  let buffer: LLMCallRecord[] = [];
  let timer: NodeJS.Timeout | null = null;
  let dirEnsured = false;
  let pending: Promise<void> = Promise.resolve();

  const ensureDir = async () => {
    if (dirEnsured) return;
    await mkdir(dirname(filePath), { recursive: true });
    dirEnsured = true;
  };

  const doFlush = async () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    try {
      await ensureDir();
      const text = batch.map((r) => JSON.stringify(r)).join("\n") + "\n";
      await appendFile(filePath, text, "utf8");
    } catch (err) {
      // Re-queue at the front; never throw to the user.
      buffer = [...batch, ...buffer];
      // eslint-disable-next-line no-console
      console.warn("[llmmeter] jsonl flush failed:", (err as Error).message);
    }
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      pending = pending.then(doFlush);
    }, flushIntervalMs);
    timer.unref?.();
  };

  return {
    name: "jsonl",
    write(record) {
      buffer.push(record);
      if (buffer.length >= maxBufferSize) {
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
