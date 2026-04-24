/**
 * Live-tail TUI: polls the database every interval and prints a live stream
 * of new LLM calls in the terminal, like `tail -f` for your AI traffic.
 *
 * Output columns: time · provider/model · tokens · cost · latency · feature · trace
 */

import type { Storage, QueryFilters } from "./storage.js";

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s: string) => c("2", s);
const red = (s: string) => c("31", s);
const green = (s: string) => c("32", s);
const yellow = (s: string) => c("33", s);
const cyan = (s: string) => c("36", s);
const bold = (s: string) => c("1", s);

export interface TailOptions {
  storage: Storage;
  intervalMs?: number;
  filters?: QueryFilters;
  /** Optional callback for testing — invoked for each line printed. */
  onLine?: (line: string) => void;
  /** Limit per poll. */
  pollLimit?: number;
  /** Stream sink. Defaults to process.stdout. */
  out?: NodeJS.WritableStream;
}

export async function tail(options: TailOptions): Promise<() => void> {
  const interval = options.intervalMs ?? 500;
  const pollLimit = options.pollLimit ?? 100;
  const out = options.out ?? process.stdout;

  // Seed cursor with current latest ts so we don't dump history on startup.
  const seed = (await options.storage.listCalls({ limit: 1 })) as Array<{ ts: number }>;
  let cursorTs = seed[0]?.ts ?? Date.now() - 1;

  let inFlight = false;

  const writeHeader = () => {
    const header = bold(
      ["time", "provider/model".padEnd(40), "in".padStart(6), "out".padStart(6), "$".padStart(8), "ms".padStart(5), "feature"].join("  "),
    );
    out.write(header + "\n" + dim("-".repeat(110)) + "\n");
  };

  writeHeader();

  const poll = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const rows = (await options.storage.listCalls({
        ...options.filters,
        fromTs: cursorTs + 1,
        limit: pollLimit,
      })) as any[];
      // listCalls orders DESC, so reverse for chronological output.
      const chrono = rows.slice().reverse();
      for (const r of chrono) {
        const line = formatLine(r);
        out.write(line + "\n");
        options.onLine?.(line);
        if (typeof r.ts === "number" && r.ts > cursorTs) cursorTs = r.ts;
      }
    } catch (err) {
      out.write(red(`[llmmeter tail] poll failed: ${(err as Error).message}\n`));
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(poll, interval);
  // First poll immediately
  void poll();

  return () => {
    clearInterval(timer);
  };
}

function formatLine(r: any): string {
  const time = new Date(r.ts).toISOString().slice(11, 23);
  const providerModel = `${r.provider}/${r.model}`.padEnd(40).slice(0, 40);
  const input = String(r.input_tokens ?? r.tokens?.input ?? 0).padStart(6);
  const output = String(r.output_tokens ?? r.tokens?.output ?? 0).padStart(6);
  const cost = (r.cost_usd ?? r.costUsd ?? 0).toFixed(5).padStart(8);
  const ms = String(r.duration_ms ?? r.durationMs ?? 0).padStart(5);
  const feature = r.feature ?? "";
  const isError = (r.status ?? "ok") === "error";
  const main = `${dim(time)}  ${cyan(providerModel)}  ${input}  ${output}  ${green("$" + cost.trim())}  ${yellow(ms)}  ${dim(feature)}`;
  if (isError) {
    return red("ERR ") + main + dim(`  ${r.error_class ?? r.errorClass ?? ""}: ${(r.error_message ?? r.errorMessage ?? "").slice(0, 80)}`);
  }
  return "    " + main;
}
