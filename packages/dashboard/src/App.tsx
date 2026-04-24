import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type BucketRow, type CallRow, type Filters, type TopRow, type Totals } from "./api.js";

const RANGES: Array<{ label: string; ms: number; bucket: number }> = [
  { label: "1h", ms: 60 * 60 * 1000, bucket: 60 },
  { label: "24h", ms: 24 * 60 * 60 * 1000, bucket: 60 * 15 },
  { label: "7d", ms: 7 * 24 * 60 * 60 * 1000, bucket: 60 * 60 * 2 },
  { label: "30d", ms: 30 * 24 * 60 * 60 * 1000, bucket: 60 * 60 * 24 },
];

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fmtMs(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n)}ms`;
}

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString();
}

function fmtBucket(ts: number, bucketSec: number): string {
  const d = new Date(ts);
  if (bucketSec >= 86400) return d.toLocaleDateString();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function App() {
  const [rangeIdx, setRangeIdx] = useState(1);
  const [filters, setFilters] = useState<Filters>({});
  const range = RANGES[rangeIdx]!;
  const fromTs = useMemo(() => Date.now() - range.ms, [range, rangeIdx]);

  const [totals, setTotals] = useState<Totals | null>(null);
  const [aggregate, setAggregate] = useState<BucketRow[]>([]);
  const [byFeature, setByFeature] = useState<TopRow[]>([]);
  const [byModel, setByModel] = useState<TopRow[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fullFilters = { ...filters, fromTs };

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [t, a, f, m, c] = await Promise.all([
        api.totals(fullFilters),
        api.aggregate(range.bucket, fullFilters),
        api.top("feature", fullFilters),
        api.top("model", fullFilters),
        api.calls({ ...fullFilters, limit: 50 }),
      ]);
      setTotals(t);
      setAggregate(a);
      setByFeature(f);
      setByModel(m);
      setCalls(c);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeIdx, filters.provider, filters.model, filters.feature, filters.status]);

  const chartData = aggregate.map((r) => ({
    ts: Number(r.bucket),
    cost: Number(r.total_cost_usd ?? 0),
    calls: Number(r.total_calls ?? 0),
    tokens: Number(r.total_input ?? 0) + Number(r.total_output ?? 0),
    errors: Number(r.errors ?? 0),
  }));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="font-semibold">llmmeter</div>
          <div className="text-zinc-500 text-sm">dashboard</div>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              onClick={() => setRangeIdx(i)}
              className={`px-2 py-1 text-xs rounded border ${
                i === rangeIdx
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "border-zinc-700 hover:border-zinc-500 text-zinc-300"
              }`}
            >
              {r.label}
            </button>
          ))}
          {loading && <div className="text-xs text-zinc-500">loading…</div>}
        </div>
      </header>

      <main className="p-6 space-y-6 max-w-7xl mx-auto">
        {err && (
          <div className="p-3 rounded border border-red-700 bg-red-950/40 text-red-200 text-sm">
            {err}
          </div>
        )}

        <FilterChips filters={filters} setFilters={setFilters} />

        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Spend" value={fmtUsd(totals?.total_cost_usd)} />
          <Kpi label="Calls" value={fmtInt(totals?.total_calls)} />
          <Kpi
            label="Tokens"
            value={fmtInt(
              (totals?.total_input ?? 0) + (totals?.total_output ?? 0),
            )}
          />
          <Kpi label="Avg latency" value={fmtMs(totals?.avg_duration_ms)} />
          <Kpi
            label="Errors"
            value={fmtInt(totals?.errors)}
            tone={totals?.errors ? "warn" : "ok"}
          />
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-zinc-300">Spend over time</h2>
            <div className="text-xs text-zinc-500">bucket {range.bucket}s · range {range.label}</div>
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <AreaChart data={chartData}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(t) => fmtBucket(Number(t), range.bucket)}
                  stroke="#71717a"
                  fontSize={11}
                />
                <YAxis stroke="#71717a" fontSize={11} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                <Tooltip
                  contentStyle={{
                    background: "#09090b",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                    color: "#fafafa",
                  }}
                  labelFormatter={(l) => fmtTs(Number(l))}
                  formatter={(v: number) => fmtUsd(v)}
                />
                <Area type="monotone" dataKey="cost" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TopCard
            title="By feature"
            rows={byFeature}
            onClick={(k) => setFilters((f) => ({ ...f, feature: k ?? undefined }))}
          />
          <TopCard
            title="By model"
            rows={byModel}
            onClick={(k) => setFilters((f) => ({ ...f, model: k ?? undefined }))}
          />
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-300">Recent calls</h2>
            <div className="text-xs text-zinc-500">{calls.length} shown</div>
          </div>
          <div className="overflow-auto max-h-[480px]">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 text-zinc-400 sticky top-0">
                <tr>
                  <Th>Time</Th>
                  <Th>Provider</Th>
                  <Th>Model</Th>
                  <Th>Op</Th>
                  <Th>Feature</Th>
                  <Th align="right">In</Th>
                  <Th align="right">Out</Th>
                  <Th align="right">Cost</Th>
                  <Th align="right">Latency</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {calls.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-800 hover:bg-zinc-900">
                    <Td>{fmtTs(c.ts)}</Td>
                    <Td>{c.provider}</Td>
                    <Td>{c.model}</Td>
                    <Td>{c.operation}</Td>
                    <Td>{c.feature ?? "—"}</Td>
                    <Td align="right">{fmtInt(c.input_tokens)}</Td>
                    <Td align="right">{fmtInt(c.output_tokens)}</Td>
                    <Td align="right">{fmtUsd(c.cost_usd)}</Td>
                    <Td align="right">{fmtMs(c.duration_ms)}</Td>
                    <Td>
                      <span
                        className={
                          c.status === "ok"
                            ? "text-emerald-400"
                            : c.status === "error"
                            ? "text-red-400"
                            : "text-amber-400"
                        }
                      >
                        {c.status}
                      </span>
                    </Td>
                  </tr>
                ))}
                {calls.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-zinc-500">
                      no calls in this range
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "warn";
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-xs text-zinc-500 uppercase tracking-wider">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold ${
          tone === "warn" ? "text-amber-400" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-3 py-2 font-normal text-${align === "right" ? "right" : "left"}`}>
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td className={`px-3 py-1.5 text-${align === "right" ? "right" : "left"} text-zinc-200`}>
      {children}
    </td>
  );
}

function TopCard({
  title,
  rows,
  onClick,
}: {
  title: string;
  rows: TopRow[];
  onClick?: (k: string | null) => void;
}) {
  const data = rows.slice(0, 8).map((r) => ({
    name: r.key ?? "(none)",
    cost: Number(r.cost_usd ?? 0),
    calls: Number(r.calls ?? 0),
  }));
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <h2 className="text-sm font-medium text-zinc-300 mb-2">{title}</h2>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 32, right: 16 }}>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
            <XAxis type="number" stroke="#71717a" fontSize={10} tickFormatter={(v) => `$${v}`} />
            <YAxis type="category" dataKey="name" stroke="#71717a" fontSize={11} width={120} />
            <Tooltip
              contentStyle={{
                background: "#09090b",
                border: "1px solid #3f3f46",
                borderRadius: 8,
                color: "#fafafa",
              }}
              formatter={(v: number) => fmtUsd(v)}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
            <Bar
              dataKey="cost"
              name="cost"
              fill="#3b82f6"
              onClick={(d: any) =>
                onClick?.(d?.payload?.name === "(none)" ? null : (d?.payload?.name ?? null))
              }
              cursor={onClick ? "pointer" : "default"}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function FilterChips({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
}) {
  const entries = Object.entries(filters).filter(([, v]) => v != null);
  if (entries.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-zinc-500">filters:</span>
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="text-xs bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded-full flex items-center gap-1"
        >
          <span className="text-zinc-500">{k}:</span>
          <span>{String(v)}</span>
          <button
            onClick={() => setFilters({ ...filters, [k]: undefined })}
            className="text-zinc-500 hover:text-zinc-200"
          >
            ×
          </button>
        </span>
      ))}
      <button
        onClick={() => setFilters({})}
        className="text-xs text-zinc-500 hover:text-zinc-200 underline"
      >
        clear all
      </button>
    </div>
  );
}
