"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  TradingChart,
  type Candle,
  type ChartLevel,
  type ChartSegment,
  type CrosshairBar,
  type SwingEmaLines,
} from "@/components/chart/TradingChart";
import { TosQuoteStrip } from "@/components/desk/TosQuoteStrip";
import type { ScreenerRow } from "@/components/scoreboard/ScoreboardRow";

type ChartPayload = {
  candles: Candle[];
  sma20?: (number | null)[];
  swing?: SwingEmaLines;
  vwapSession?: (number | null)[];
  vwapAnchored?: (number | null)[];
  source?: string;
  interval?: string;
};

type Props = {
  symbol: string | null;
  companyName?: string;
  interval: "1d" | "5m";
  onIntervalChange?: (tf: "1d" | "5m") => void;
  /** Omit when `fill` is true to size from the parent container. */
  height?: number;
  fill?: boolean;
  levels?: ChartLevel[];
  segments?: ChartSegment[];
  toolbarExtra?: ReactNode;
  /** TOS-style quote + crosshair strip above the chart */
  quoteRow?: ScreenerRow | null;
  showQuoteStrip?: boolean;
};

export function ChartPane({
  symbol,
  companyName,
  interval,
  onIntervalChange,
  height = 480,
  fill = false,
  levels = [],
  segments = [],
  toolbarExtra,
  quoteRow = null,
  showQuoteStrip = false,
}: Props) {
  const [chart, setChart] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [crosshair, setCrosshair] = useState<CrosshairBar | null>(null);
  useEffect(() => {
    if (!symbol) {
      setChart(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setCrosshair(null);
    fetch(`/api/chart/${symbol}?interval=${interval}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("chart");
        return r.json();
      })
      .then((x) => setChart(x))
      .catch(() => setChart(null))
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [symbol, interval]);

  const chartBoxStyle = fill || height == null ? undefined : { height };

  if (!symbol) {
    return (
      <div
        className="flex h-full min-h-[160px] items-center justify-center rounded border border-dashed border-[var(--border)] bg-[var(--surface-alt)] text-xs font-terminal text-[var(--text-muted)]"
        style={height != null ? { minHeight: height } : undefined}
      >
        Select a ticker from the watchlist
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 min-w-0 flex-col ${fill ? "h-full min-h-0 flex-1" : ""}`}>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2">
        <Link href={`/ticker/${symbol}?swing=1`} className="font-terminal font-bold text-[var(--accent-info)] hover:underline">
          {symbol}
        </Link>
        {companyName && <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[200px]">{companyName}</span>}
        <span className="text-[10px] text-[var(--text-muted)]">
          {chart?.interval ?? interval} · {chart?.source ?? (loading ? "…" : "—")}
        </span>
        {onIntervalChange && (
          <div className="flex gap-1 ml-2">
            {(["1d", "5m"] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onIntervalChange(tf)}
                className={`px-2 py-0.5 text-[10px] font-terminal rounded border ${
                  interval === tf
                    ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                    : "border-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>
        )}
        {toolbarExtra}
        {showQuoteStrip && (
          <span className="ml-auto text-[10px] text-[var(--text-muted)] hidden lg:inline">
            ↑↓ symbol · D daily · 5 intraday
          </span>
        )}
      </div>
      {showQuoteStrip && (
        <TosQuoteStrip
          row={quoteRow}
          crosshair={crosshair}
          interval={chart?.interval ?? interval}
        />
      )}
      <div
        className={`relative min-h-0 min-w-0 overflow-hidden bg-[var(--card-bg)] ${fill ? "flex-1" : ""}`}
        style={chartBoxStyle}
      >
        <div className="absolute inset-0">
          {loading && !chart?.candles?.length ? (
            <div className="flex h-full items-center justify-center text-xs font-terminal text-[var(--text-muted)]">
              Loading chart…
            </div>
          ) : (
            <TradingChart
              candles={chart?.candles ?? []}
              sma={chart?.interval === "1d" ? chart?.sma20 : undefined}
              swing={chart?.interval === "1d" ? chart?.swing : undefined}
              vwapSession={chart?.interval === "5m" ? chart?.vwapSession : undefined}
              vwapAnchored={chart?.interval === "5m" ? chart?.vwapAnchored : undefined}
              segments={segments}
              levels={levels}
              fill
              onCrosshairBar={showQuoteStrip ? setCrosshair : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
