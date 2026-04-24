/**
 * Default redaction. Walks the value, replaces obvious PII/secrets with [REDACTED].
 * Cheap; not a substitute for a real DLP pipeline. Users can pass their own.
 */

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { name: "credit-card", re: /\b(?:\d[ -]*?){13,16}\b/g },
  { name: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "openai-key", re: /sk-[A-Za-z0-9_\-]{20,}/g },
  { name: "anthropic-key", re: /sk-ant-[A-Za-z0-9_\-]{20,}/g },
  { name: "google-key", re: /AIza[0-9A-Za-z_\-]{35}/g },
  { name: "aws-key", re: /AKIA[0-9A-Z]{16}/g },
  { name: "jwt", re: /eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g },
  { name: "bearer", re: /Bearer\s+[A-Za-z0-9_\-.=]+/gi },
];

function redactString(s: string): string {
  let out = s;
  for (const { re } of PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

const SEEN = new WeakSet<object>();

export function defaultRedact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (SEEN.has(value as object)) return "[Circular]";
  SEEN.add(value as object);
  try {
    if (Array.isArray(value)) {
      return value.map((v) => defaultRedact(v));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = defaultRedact(v);
    }
    return out;
  } finally {
    SEEN.delete(value as object);
  }
}

/** SHA-256 hex of stringified content; for grouping prompts without storing them. */
export async function hashPrompt(value: unknown): Promise<string> {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Node fallback
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}
