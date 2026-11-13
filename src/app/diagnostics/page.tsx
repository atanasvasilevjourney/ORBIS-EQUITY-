"use client";

import { useCallback, useEffect, useState } from "react";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { TrendRibbonChart } from "@/components/diagnostics/TrendRibbonChart";
import type { DiagnosticChart, DiagnosticRow } from "@/lib/trendDiagnostics";

type Payload = {
  mode: "absolute" | "relative";
  benchmark: string;
  asOf: string | null;
  focus: string;
  rows: DiagnosticRow[];
  chart: DiagnosticChart | null;
  disclaimer: string;
  missing: string[];
  source: string;
};

function signed(v: number | null, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const body = Math.abs(v).toFixed(digits);
  if (v > 0) return `+${body}`;
  if (v < 0) return `-${body}`;
  return body;
}

function tone(v: number | null): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "var(--text-muted)";
  return v > 0 ? "var(--accent-bull)" : "var(--accent-bear)";
}

function stateColor(state: string): string {
  if (state.startsWith("Up") || state === "Turning up") return "var(--accent-bull)";
  if (state.startsWith("Down") || state === "Turning down") return "var(--accent-bear)";
  if (state.includes("fading")) return "var(--accent-warning)";
  return "var(--text-secondary)";
}

export default function DiagnosticsPage() {
  const [mode, setMode] = useState<"absolute" | "relative">("absolute");
  const [focus, setFocus] = useState("SPY");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({ mode, focus });
      const res = await fetch(`/api/diagnostics?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Payload;
      setData(body);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [mode, focus]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows ?? [];
  const chart = data?.chart ?? null;

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="TREND"
        title="Trend diagnostics"
        description="Where large caps, mid caps, small caps, equal weight, bonds, gold, commodities, the dollar, and crypto sit on trend. EWMAC, breakout, and acceleration, each on the same ±20 scale. The blend is 40% EWMAC, 40% breakout, 20% acceleration."
        source="Carver rules · daily · not a signal"
        accent="var(--accent-info)"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("absolute")}
          className="px-3 py-1.5 text-[11px] font-terminal tracking-widest rounded border"
          style={{
            borderColor: "var(--panel-border)",
            background: mode === "absolute" ? "rgba(56, 189, 248, 0.15)" : "var(--card-bg)",
            color: mode === "absolute" ? "var(--accent-info)" : "var(--text-secondary)",
          }}
        >
          OWN TREND
        </button>
        <button
          type="button"
          onClick={() => setMode("relative")}
          className="px-3 py-1.5 text-[11px] font-terminal tracking-widest rounded border"
          style={{
            borderColor: "var(--panel-border)",
            background: mode === "relative" ? "rgba(56, 189, 248, 0.15)" : "var(--card-bg)",
            color: mode === "relative" ? "var(--accent-info)" : "var(--text-secondary)",
          }}
        >
          VS {data?.benchmark ?? "SPY"}
        </button>
        <span className="text-[10px] font-terminal text-[var(--text-muted)]">
          as of {data?.asOf ?? "—"}
          {data?.source ? ` · ${data.source}` : ""}
          {loading ? " · loading" : ""}
        </span>
      </div>

      {data?.disclaimer && (
        <p className="text-xs font-terminal text-[var(--text-muted)] border border-[var(--panel-border)] rounded px-3 py-2 bg-[var(--surface-alt)]">
          {data.disclaimer}
          {mode === "relative"
            ? " Relative mode measures each asset against SPY. SPY itself is blank, because SPY divided by SPY is a flat line. Crypto lookbacks are not stretched here, because the ratio only prints on equity sessions."
            : " About ±10 is a normal-strength reading. About ±20 is as strong as that asset's own history gets. EWMAC inside ±5 is no trend. Acceleration inside ±2 is flat."}
        </p>
      )}

      <ModulePanel
        title={mode === "relative" ? "RELATIVE TO SPY" : "ASSET CLASS TRENDS"}
        badge={mode === "relative" ? "vs SPY" : "absolute"}
        accent="var(--accent-info)"
        source={`${rows.length} rows`}
      >
        {error ? (
          <EmptyState title="Failed to load trend diagnostics" detail="Yahoo daily history did not come back. Try again in a minute." />
        ) : loading && !data ? (
          <p className="px-3 py-8 text-center text-[var(--text-muted)] font-terminal text-sm">Loading daily history…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-terminal">
              <thead>
                <tr className="text-[10px] tracking-widest text-[var(--text-muted)] border-b border-[var(--panel-border)]">
                  <th className="text-left px-3 py-2 font-normal">ASSET</th>
                  <th className="text-right px-3 py-2 font-normal">LAST</th>
                  <th className="text-right px-3 py-2 font-normal">DAY</th>
                  <th className="text-right px-3 py-2 font-normal">EWMAC</th>
                  <th className="text-right px-3 py-2 font-normal">BREAKOUT</th>
                  <th className="text-right px-3 py-2 font-normal">ACCEL</th>
                  <th className="text-right px-3 py-2 font-normal">COMBINED</th>
                  <th className="text-right px-3 py-2 font-normal">AGREE</th>
                  <th className="text-left px-3 py-2 font-normal">STATE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const selected = row.symbol === (data?.focus ?? focus);
                  return (
                    <tr
                      key={row.symbol}
                      onClick={() => {
                        if (row.reason !== "benchmark") setFocus(row.symbol);
                      }}
                      className="border-b border-[var(--panel-border)] cursor-pointer hover:bg-[var(--surface-alt)]"
                      style={{ background: selected ? "rgba(56, 189, 248, 0.06)" : undefined }}
                    >
                      <td className="px-3 py-2">
                        <div className="text-[var(--text-primary)]">{row.label}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {row.symbol}
                          {row.ribbon === "up" ? " · ribbon up" : row.ribbon === "down" ? " · ribbon down" : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.last == null ? "—" : row.last.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: tone(row.dayPct) }}>
                        {row.dayPct == null ? "—" : `${signed(row.dayPct, 2)}%`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: tone(row.ewmac) }}>{signed(row.ewmac)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: tone(row.breakout) }}>{signed(row.breakout)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: tone(row.accel) }}>{signed(row.accel)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tone(row.combined) }}>{signed(row.combined)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.agree ?? "—"}</td>
                      <td className="px-3 py-2" style={{ color: stateColor(row.state) }}>
                        {row.reason === "benchmark" ? "n/a" : row.state}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ModulePanel>

      <ModulePanel
        title="EMA RIBBON"
        badge={chart ? `${chart.fastPeriod}/${chart.slowPeriod}` : "—"}
        accent={chart && chart.emaFast.at(-1) != null && chart.emaSlow.at(-1) != null && (chart.emaFast.at(-1) as number) >= (chart.emaSlow.at(-1) as number) ? "var(--accent-bull)" : "var(--accent-bear)"}
        source={mode === "relative" ? "ratio vs SPY" : "adjusted close"}
      >
        {chart && chart.candles.length > 1 ? (
          <TrendRibbonChart
            candles={chart.candles}
            emaFast={chart.emaFast}
            emaSlow={chart.emaSlow}
            fastPeriod={chart.fastPeriod}
            slowPeriod={chart.slowPeriod}
            symbol={chart.symbol}
            label={chart.label}
          />
        ) : (
          <EmptyState
            title={mode === "relative" && focus === "SPY" ? "SPY has no relative series" : "No ribbon yet"}
            detail="Pick another row. The shaded band is the fast EMA minus the slow EMA, green when the fast one is above."
          />
        )}
      </ModulePanel>

      {data?.missing?.length ? (
        <p className="text-[10px] font-terminal text-[var(--text-muted)]">
          Missing history: {data.missing.join(", ")}. Those rows stay blank until a daily series is available.
        </p>
      ) : null}
    </div>
  );
}
