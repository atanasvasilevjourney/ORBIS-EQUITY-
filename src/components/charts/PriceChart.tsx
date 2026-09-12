"use client";

import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi } from "lightweight-charts";

type Bar = {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
};

type PriceChartProps = {
  bars: Bar[];
  height?: number;
};

/** EOD candlestick chart — delayed data, theme-aware. */
export function PriceChart({ bars, height = 280 }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const styles = getComputedStyle(document.documentElement);
    const textColor = styles.getPropertyValue("--text-secondary").trim() || "#9ca3af";
    const gridColor = styles.getPropertyValue("--panel-grid").trim() || "#1a2330";
    const bull = styles.getPropertyValue("--accent-bull").trim() || "#00ff88";
    const bear = styles.getPropertyValue("--accent-bear").trim() || "#ff3366";
    const bg = styles.getPropertyValue("--panel-bg").trim() || "#0d1117";

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { color: bg },
        textColor,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      rightPriceScale: { borderColor: gridColor },
      timeScale: { borderColor: gridColor, timeVisible: false },
      crosshair: { mode: 1 },
    });

    const series = chart.addCandlestickSeries({
      upColor: bull,
      downColor: bear,
      borderUpColor: bull,
      borderDownColor: bear,
      wickUpColor: bull,
      wickDownColor: bear,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    const data = bars
      .filter((b) => b.close != null && b.time)
      .map((b) => ({
        time: b.time as `${number}-${number}-${number}`,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
    seriesRef.current.setData(data);
    chartRef.current.timeScale().fitContent();
  }, [bars]);

  if (bars.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded border border-[var(--panel-border)] text-xs font-terminal text-[var(--text-muted)]"
        style={{ height }}
      >
        No EOD price history available
      </div>
    );
  }

  return (
    <div className="relative rounded border border-[var(--panel-border)] overflow-hidden">
      <div ref={containerRef} />
      <div className="absolute top-2 left-2 text-[9px] font-terminal tracking-wider text-[var(--text-muted)] bg-[var(--panel-bg)]/80 px-1.5 py-0.5 rounded">
        EOD · DELAYED
      </div>
    </div>
  );
}
