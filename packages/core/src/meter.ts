/**
 * `meter()` is implemented in each adapter package (provider-specific Proxy).
 * This file holds the shared resolved-options helper plus a process-wide
 * shutdown registry so SIGTERM/SIGINT/exit always flush pending records.
 */

import { jsonlSink } from "./sinks/jsonl.js";
import { Recorder, type ResolvedMeter } from "./recorder.js";
import type { MeterOptions, Sink } from "./types.js";

const registeredSinks = new Set<Sink>();
let shutdownInstalled = false;

function installShutdownHandlers() {
  if (shutdownInstalled) return;
  shutdownInstalled = true;
  const flushAll = async () => {
    await Promise.allSettled(Array.from(registeredSinks).map((s) => s.flush()));
  };
  const close = async () => {
    await Promise.allSettled(Array.from(registeredSinks).map((s) => s.close()));
  };
  // Best-effort flush on graceful shutdown.
  if (typeof process !== "undefined" && typeof process.on === "function") {
    process.on("beforeExit", flushAll);
    process.on("SIGTERM", () => {
      void close().finally(() => process.exit(0));
    });
    process.on("SIGINT", () => {
      void close().finally(() => process.exit(0));
    });
  }
}

/** Internal: build a Recorder from the user's options, applying defaults. */
export function buildRecorder(options: MeterOptions = {}): Recorder {
  const sink = options.sink ?? jsonlSink();
  registeredSinks.add(sink);
  installShutdownHandlers();
  const meter: ResolvedMeter = { sink, options: { ...options, sink } };
  return new Recorder(meter);
}

/** Manually flush every sink we've seen. Useful in serverless / test cleanup. */
export async function flushAll(): Promise<void> {
  await Promise.allSettled(Array.from(registeredSinks).map((s) => s.flush()));
}

/** Manually close every sink. */
export async function shutdown(): Promise<void> {
  await Promise.allSettled(Array.from(registeredSinks).map((s) => s.close()));
  registeredSinks.clear();
}
