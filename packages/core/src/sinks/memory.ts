import type { LLMCallRecord, Sink } from "../types.js";

/** In-memory sink for tests and ephemeral inspection. */
export interface MemorySink extends Sink {
  readonly records: LLMCallRecord[];
  clear(): void;
}

export function memorySink(): MemorySink {
  const records: LLMCallRecord[] = [];
  return {
    name: "memory",
    records,
    write(r) {
      records.push(r);
    },
    clear() {
      records.length = 0;
    },
    async flush() {},
    async close() {},
  };
}
