#!/usr/bin/env node
/**
 * llmmeter CLI
 *
 * Commands:
 *   llmmeter dashboard [--db PATH] [--port N] [--no-open]
 *   llmmeter serve     --db PATH | --pg URL  [--port N] [--ingest-token T] [--dashboard-token T]
 *   llmmeter export    --db PATH --format jsonl|csv [--out FILE]
 *   llmmeter prune     --db PATH --older-than 30d
 *   llmmeter pricing   list [--provider X]
 *   llmmeter version
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDashboardServer } from "./server.js";
import { openPostgresStorage, openSqliteStorage } from "./storage.js";
import { tail as tailLive } from "./tail.js";
import { analyzeRouting, suggestUntestedAlternatives } from "./analyze.js";

const HELP = `llmmeter — observability and cost tracking for LLM SDKs

Usage:
  llmmeter dashboard [--db PATH] [--port N] [--no-open]
      Start a local read-only dashboard against a SQLite file.
      Default --db ./.amit641/llmmeter.db

  llmmeter tail [--db PATH] [--feature F] [--provider P] [--interval MS]
      Live tail of incoming LLM calls in your terminal (like 'tail -f').

  llmmeter analyze [--db PATH] [--since 14d] [--min-cluster 5] [--include-untested]
      Surface smart routing suggestions: which feature/prompts could move to
      a cheaper model based on historical traffic.

  llmmeter serve --db PATH | --pg URL [options]
      Run the production collector + dashboard. Accepts ingest POSTs at /ingest.
      Options:
        --port N
        --host H               (default 0.0.0.0)
        --ingest-token T       (require Bearer token on /ingest)
        --dashboard-token T    (require Bearer token on /api and /)
        --pg URL               (use Postgres instead of SQLite)

  llmmeter export --db PATH --format jsonl|csv [--out FILE]
      Dump all calls to stdout or a file.

  llmmeter prune --db PATH --older-than 30d
      Delete records older than the given duration (s/m/h/d/w).

  llmmeter pricing list [--provider X]
      Print the bundled price table.

  llmmeter version
      Print version.

Cloud (coming soon):
  Hosted ingest + dashboard at https://llmmeter.dev/cloud
`;

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  const eq = args.find((a) => a.startsWith(name + "="));
  if (eq) return eq.slice(name.length + 1);
  return undefined;
}
function bool(name: string): boolean {
  return args.includes(name);
}

async function main() {
  const cmd = args[0];
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const pkg = JSON.parse(await readFile(resolve(here, "../package.json"), "utf8"));
    process.stdout.write(`${pkg.name} ${pkg.version}\n`);
    return;
  }

  switch (cmd) {
    case "dashboard":
      return await runDashboard();
    case "tail":
      return await runTail();
    case "analyze":
      return await runAnalyze();
    case "serve":
      return await runServe();
    case "export":
      return await runExport();
    case "prune":
      return await runPrune();
    case "pricing":
      return await runPricing();
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${HELP}`);
      process.exit(2);
  }
}

function resolveStaticDir(): string {
  // CLI bundle ships static files at <pkg>/static
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidate = resolve(here, "../static");
  return existsSync(candidate) ? candidate : "";
}

async function runDashboard() {
  const dbPath = flag("--db") ?? "./.amit641/llmmeter.db";
  const port = Number(flag("--port") ?? "3737");
  const noOpen = bool("--no-open");
  if (!existsSync(dbPath)) {
    process.stderr.write(
      `[llmmeter] no database found at ${dbPath}.\n` +
        `Run your app with llmmeter wired up first, or pass --db PATH.\n`,
    );
    process.exit(1);
  }
  const storage = await openSqliteStorage(dbPath);
  const server = createDashboardServer({
    storage,
    port,
    host: "127.0.0.1",
    staticDir: resolveStaticDir(),
  });
  const { url } = await server.listen();
  process.stdout.write(`\n  llmmeter dashboard ready at ${url}\n  reading ${dbPath}\n\n`);
  if (!noOpen) tryOpen(url);
  installShutdown(() => server.close());
}

async function runServe() {
  const port = Number(flag("--port") ?? "8080");
  const host = flag("--host") ?? "0.0.0.0";
  const ingestToken = flag("--ingest-token") ?? process.env.LLMMETER_INGEST_TOKEN;
  const dashboardToken = flag("--dashboard-token") ?? process.env.LLMMETER_DASHBOARD_TOKEN;
  const pg = flag("--pg") ?? process.env.LLMMETER_DB_URL;
  const dbPath = flag("--db") ?? process.env.LLMMETER_DB_PATH;

  let storage;
  if (pg) {
    storage = await openPostgresStorage(pg);
  } else if (dbPath) {
    storage = await openSqliteStorage(dbPath);
  } else {
    process.stderr.write(
      `[llmmeter] serve requires --db PATH or --pg URL (or LLMMETER_DB_URL / LLMMETER_DB_PATH).\n`,
    );
    process.exit(1);
  }

  const server = createDashboardServer({
    storage,
    port,
    host,
    staticDir: resolveStaticDir(),
    ingestToken,
    dashboardToken,
  });
  const { url } = await server.listen();
  process.stdout.write(
    `\n  llmmeter collector + dashboard listening on ${url}\n` +
      `  storage: ${pg ? "postgres" : "sqlite"}\n` +
      `  ingest token: ${ingestToken ? "required" : "DISABLED (open ingest)"}\n` +
      `  dashboard token: ${dashboardToken ? "required" : "DISABLED (open dashboard)"}\n\n`,
  );
  installShutdown(() => server.close());
}

async function runExport() {
  const dbPath = flag("--db") ?? "./.amit641/llmmeter.db";
  const format = (flag("--format") ?? "jsonl").toLowerCase();
  const out = flag("--out");
  if (!existsSync(dbPath)) {
    process.stderr.write(`[llmmeter] no database at ${dbPath}\n`);
    process.exit(1);
  }
  const storage = await openSqliteStorage(dbPath);
  const rows = (await storage.listCalls({ limit: 1000000 })) as any[];
  let text: string;
  if (format === "csv") {
    if (rows.length === 0) {
      text = "";
    } else {
      const headers = Object.keys(rows[0]);
      const escape = (v: unknown) => {
        if (v == null) return "";
        const s = String(v);
        if (s.includes(",") || s.includes("\n") || s.includes('"')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };
      text =
        headers.join(",") +
        "\n" +
        rows.map((r) => headers.map((h) => escape((r as any)[h])).join(",")).join("\n") +
        "\n";
    }
  } else {
    text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  }
  if (out) {
    await writeFile(out, text, "utf8");
    process.stdout.write(`wrote ${rows.length} rows to ${out}\n`);
  } else {
    process.stdout.write(text);
  }
  await storage.close();
}

const DURATION_RE = /^(\d+)\s*(s|m|h|d|w)$/i;
function parseDuration(s: string): number {
  const m = DURATION_RE.exec(s);
  if (!m) throw new Error(`invalid duration: ${s} (use 30d, 2w, 12h)`);
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 7 * 86_400_000;
  return n * mult;
}

async function runPrune() {
  const dbPath = flag("--db") ?? "./.amit641/llmmeter.db";
  const older = flag("--older-than");
  if (!older) {
    process.stderr.write("--older-than required (e.g. 30d)\n");
    process.exit(1);
  }
  const ms = parseDuration(older);
  const storage = await openSqliteStorage(dbPath);
  const removed = await storage.pruneOlderThan(Date.now() - ms);
  process.stdout.write(`pruned ${removed} records older than ${older}\n`);
  await storage.close();
}

async function runPricing() {
  const sub = args[1];
  if (sub !== "list") {
    process.stderr.write("usage: llmmeter pricing list [--provider X]\n");
    process.exit(2);
  }
  const provider = flag("--provider");
  const { PRICE_TABLE } = await import("@llmmeter/core");
  const rows = PRICE_TABLE.filter((p) => !provider || p.provider === provider);
  for (const r of rows) {
    process.stdout.write(
      `${r.provider.padEnd(10)} ${r.model.padEnd(40)} in $${r.inputPer1M}/M  out $${r.outputPer1M}/M${
        r.cachedInputPer1M != null ? `  cached $${r.cachedInputPer1M}/M` : ""
      }\n`,
    );
  }
}

async function runTail() {
  const dbPath = flag("--db") ?? "./.amit641/llmmeter.db";
  const interval = Number(flag("--interval") ?? "500");
  const feature = flag("--feature");
  const provider = flag("--provider");
  if (!existsSync(dbPath)) {
    process.stderr.write(`[llmmeter] no database at ${dbPath}\n`);
    process.exit(1);
  }
  const storage = await openSqliteStorage(dbPath);
  const stop = await tailLive({
    storage,
    intervalMs: interval,
    filters: { feature, provider },
  });
  installShutdown(async () => {
    stop();
    await storage.close();
  });
}

async function runAnalyze() {
  const dbPath = flag("--db") ?? "./.amit641/llmmeter.db";
  const sinceStr = flag("--since") ?? "14d";
  const minCluster = Number(flag("--min-cluster") ?? "5");
  const includeUntested = bool("--include-untested");
  const minConfidence = Number(flag("--min-confidence") ?? "0.95");
  if (!existsSync(dbPath)) {
    process.stderr.write(`[llmmeter] no database at ${dbPath}\n`);
    process.exit(1);
  }
  const sinceMs = parseDuration(sinceStr);
  const storage = await openSqliteStorage(dbPath);
  const tested = await analyzeRouting({ storage, sinceMs, minClusterSize: minCluster, minConfidence });

  if (tested.length === 0) {
    process.stdout.write("No routing suggestions yet — need more historical data with overlapping prompts across models.\n\n");
  } else {
    process.stdout.write(`\nRouting suggestions (window: ${sinceStr}, ${tested.length} found)\n`);
    process.stdout.write("-".repeat(80) + "\n");
    for (const s of tested) {
      process.stdout.write(
        `\n  ${s.feature}\n` +
          `    ${s.fromProvider}/${s.fromModel}  →  ${s.toProvider}/${s.toModel}\n` +
          `    calls=${s.callCount}  current=$${s.currentCostPerCall.toFixed(6)}/call  candidate=$${s.candidateCostPerCall.toFixed(6)}/call\n` +
          `    estimated savings: $${s.savedUsd.toFixed(2)} over the window  (confidence ${(s.confidence * 100).toFixed(1)}%)\n` +
          `    reason: ${s.reason}\n`,
      );
    }
  }

  if (includeUntested) {
    const untested = await suggestUntestedAlternatives({ storage, sinceMs });
    if (untested.length > 0) {
      process.stdout.write(`\nUntested same-provider alternatives (A/B before switching!)\n`);
      process.stdout.write("-".repeat(80) + "\n");
      for (const s of untested.slice(0, 20)) {
        process.stdout.write(
          `\n  ${s.feature}\n` +
            `    current: ${s.fromProvider}/${s.fromModel}  →  candidate: ${s.candidateProvider}/${s.candidateModel}\n` +
            `    calls=${s.callCount}  estimated savings: $${s.estimatedSavedUsd.toFixed(2)}\n` +
            `    ${s.reason}\n`,
        );
      }
    }
  }

  await storage.close();
}

function tryOpen(url: string) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // ignore
  }
}

function installShutdown(close: () => Promise<void>) {
  let closed = false;
  const onSig = () => {
    if (closed) return;
    closed = true;
    void close().finally(() => process.exit(0));
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);
}

main().catch((err) => {
  process.stderr.write(`[llmmeter] ${err?.stack ?? err}\n`);
  process.exit(1);
});
