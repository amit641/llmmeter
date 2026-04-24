/**
 * Zero-dep HTTP server for the dashboard + ingest collector.
 *
 * Routes:
 *   GET  /api/health
 *   GET  /api/totals?...filters
 *   GET  /api/aggregate?bucket=60&...filters
 *   GET  /api/top?dim=feature&...filters
 *   GET  /api/calls?...filters
 *   POST /ingest               (collector mode; requires ingest token if set)
 *   GET  /*                    (static dashboard files, falls back to index.html)
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import type { LLMCallRecord } from "llmmeter-core";
import type { QueryFilters, Storage } from "./storage.js";

export interface ServerOptions {
  storage: Storage;
  port?: number;
  host?: string;
  staticDir?: string;
  /** If set, /ingest requires `Authorization: Bearer <ingestToken>`. */
  ingestToken?: string;
  /** If set, all dashboard routes require `Authorization: Bearer <dashboardToken>`. */
  dashboardToken?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

function parseFilters(url: URL): QueryFilters {
  const f: QueryFilters = {};
  const params = url.searchParams;
  if (params.has("provider")) f.provider = params.get("provider")!;
  if (params.has("model")) f.model = params.get("model")!;
  if (params.has("feature")) f.feature = params.get("feature")!;
  if (params.has("userId")) f.userId = params.get("userId")!;
  if (params.has("status")) f.status = params.get("status")! as QueryFilters["status"];
  if (params.has("fromTs")) f.fromTs = Number(params.get("fromTs"));
  if (params.has("toTs")) f.toTs = Number(params.get("toTs"));
  if (params.has("limit")) f.limit = Number(params.get("limit"));
  if (params.has("offset")) f.offset = Number(params.get("offset"));
  return f;
}

function jsonResponse(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function checkAuth(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const header = req.headers.authorization;
  return header === `Bearer ${token}`;
}

async function readBody(req: IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string,
  pathname: string,
): Promise<boolean> {
  if (!staticDir) return false;
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let candidate = resolve(staticDir, "." + safe);
  if (!candidate.startsWith(resolve(staticDir))) return false;
  try {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      const ct = MIME[extname(candidate)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": ct, "cache-control": "public, max-age=300" });
      createReadStream(candidate).pipe(res);
      return true;
    }
    // SPA fallback to index.html
    candidate = resolve(staticDir, "index.html");
    if (existsSync(candidate)) {
      const html = await readFile(candidate, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function createDashboardServer(opts: ServerOptions) {
  const port = opts.port ?? 3737;
  const host = opts.host ?? "127.0.0.1";
  const staticDir = opts.staticDir ?? "";

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      // Ingest route (collector mode)
      if (req.method === "POST" && url.pathname === "/ingest") {
        if (!checkAuth(req, opts.ingestToken)) return jsonResponse(res, { error: "unauthorized" }, 401);
        const body = await readBody(req);
        let parsed: { records?: LLMCallRecord[] };
        try {
          parsed = JSON.parse(body);
        } catch {
          return jsonResponse(res, { error: "invalid JSON" }, 400);
        }
        const records = Array.isArray(parsed?.records) ? parsed!.records! : [];
        if (records.length > 0) await opts.storage.ingest(records);
        return jsonResponse(res, { ok: true, ingested: records.length });
      }

      // API routes (dashboard auth)
      if (url.pathname.startsWith("/api/")) {
        if (!checkAuth(req, opts.dashboardToken))
          return jsonResponse(res, { error: "unauthorized" }, 401);
        const filters = parseFilters(url);
        switch (url.pathname) {
          case "/api/health":
            return jsonResponse(res, { ok: true });
          case "/api/totals":
            return jsonResponse(res, await opts.storage.totals(filters));
          case "/api/aggregate": {
            const bucket = Number(url.searchParams.get("bucket") ?? "60");
            return jsonResponse(res, await opts.storage.aggregateByBucket(bucket, filters));
          }
          case "/api/top": {
            const dim = (url.searchParams.get("dim") ?? "feature") as
              | "provider"
              | "model"
              | "feature"
              | "user_id";
            return jsonResponse(res, await opts.storage.topByDimension(dim, filters));
          }
          case "/api/calls":
            return jsonResponse(res, await opts.storage.listCalls(filters));
          default:
            return jsonResponse(res, { error: "not found" }, 404);
        }
      }

      // Static
      if (req.method === "GET" || req.method === "HEAD") {
        if (await serveStatic(req, res, staticDir, url.pathname)) return;
        // fallback message when no static bundle is shipped
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(fallbackHtml(port));
        return;
      }

      jsonResponse(res, { error: "method not allowed" }, 405);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[llmmeter] server error:", err);
      jsonResponse(res, { error: "internal error" }, 500);
    }
  };

  const server = createServer(handler);

  return {
    listen(): Promise<{ url: string }> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          resolve({ url: `http://${host}:${port}` });
        });
      });
    },
    async close(): Promise<void> {
      await new Promise<void>((r) => server.close(() => r()));
      await opts.storage.close();
    },
    server,
  };
}

function fallbackHtml(port: number) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>llmmeter</title>
<style>body{font:14px/1.5 system-ui, sans-serif;max-width:640px;margin:64px auto;padding:0 16px;color:#111}
code{background:#f4f4f5;padding:2px 6px;border-radius:4px}
a{color:#2563eb}</style></head><body>
<h1>llmmeter is running</h1>
<p>The dashboard UI bundle wasn't found in this install. The API is live at:</p>
<ul>
<li><code>GET /api/totals</code></li>
<li><code>GET /api/aggregate?bucket=60</code></li>
<li><code>GET /api/top?dim=feature</code></li>
<li><code>GET /api/calls</code></li>
</ul>
<p>Try: <a href="/api/totals">/api/totals</a></p>
<p>Server running on <code>http://localhost:${port}</code>.</p>
</body></html>`;
}

export type { Storage, QueryFilters } from "./storage.js";
