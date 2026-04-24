export interface Filters {
  provider?: string;
  model?: string;
  feature?: string;
  userId?: string;
  status?: "ok" | "error" | "cancelled";
  fromTs?: number;
  toTs?: number;
}

export interface Totals {
  total_calls: number;
  total_cost_usd: number;
  total_input: number;
  total_output: number;
  errors: number;
  avg_duration_ms: number;
}

export interface BucketRow {
  bucket: number;
  total_calls: number;
  total_cost_usd: number;
  total_input: number;
  total_output: number;
  errors: number;
}

export interface TopRow {
  key: string | null;
  calls: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface CallRow {
  id: string;
  trace_id: string;
  ts: number;
  provider: string;
  model: string;
  operation: string;
  duration_ms: number;
  ttft_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  status: string;
  error_class: string | null;
  user_id: string | null;
  feature: string | null;
  prompt_hash: string;
}

function qs(filters: Filters & Record<string, unknown> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? "?" + s : "";
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

export const api = {
  totals: (f?: Filters) => get<Totals>("/api/totals" + qs(f)),
  aggregate: (bucket: number, f?: Filters) =>
    get<BucketRow[]>("/api/aggregate" + qs({ ...f, bucket })),
  top: (dim: "provider" | "model" | "feature" | "user_id", f?: Filters) =>
    get<TopRow[]>("/api/top" + qs({ ...f, dim })),
  calls: (f?: Filters & { limit?: number }) =>
    get<CallRow[]>("/api/calls" + qs({ ...f, limit: f?.limit ?? 100 })),
};
