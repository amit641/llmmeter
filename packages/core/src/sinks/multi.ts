import type { LLMCallRecord, Sink } from "../types.js";

/** Fan out records to multiple sinks. Failures in one sink don't affect others. */
export function multiSink(...sinks: Sink[]): Sink {
  return {
    name: `multi(${sinks.map((s) => s.name).join(",")})`,
    write(record: LLMCallRecord) {
      for (const s of sinks) {
        try {
          s.write(record);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[llmmeter] sink "${s.name}" write failed:`, (err as Error).message);
        }
      }
    },
    async flush() {
      await Promise.allSettled(sinks.map((s) => s.flush()));
    },
    async close() {
      await Promise.allSettled(sinks.map((s) => s.close()));
    },
  };
}
