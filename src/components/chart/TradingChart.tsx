"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme/ThemeProvider";

export type Candle = {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type ChartLevel = {
  price: number;
  title: string;
  color: string;
  dashed?: boolean;
};

type Props = {
  candles: Candle[];
  sma?: (number | null)[];
  levels: ChartLevel[];
  height?: number;
};

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function resolveColor(c: string) {
  const m = c.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (m) return cssVar(m[1], c);
  return c;
}

export function TradingChart({ candles, sma, levels, height = 420 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const el = wrap.current;
    if (!el || candles.length < 2) return;
    let disposed = false;
    let chart: any = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      const { createChart, ColorType, LineStyle, CrosshairMode } = await import("lightweight-charts");
      if (disposed || !wrap.current) return;
      const bull = cssVar("--accent-bull", "#00ff88");
      const bear = cssVar("--accent-bear", "#ff3366");
      const info = cssVar("--accent-info", "#00aaff");
      const text = cssVar("--text-secondary", "#9ca3af");
      const grid = cssVar("--border", "#1e2733");
      const bg = cssVar("--card-bg", "#0d1117");
      chart = createChart(el, {
        width: el.clientWidth,
        height,
        layout: {
          background: { type: ColorType.Solid, color: bg },
          textColor: text,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: grid },
          horzLines: { color: grid },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: grid },
        timeScale: { borderColor: grid, timeVisible: typeof candles[0].time === "number", secondsVisible: false },
      });
      const candleSeries = chart.addCandlestickSeries({
        upColor: bull,
        downColor: bear,
        borderUpColor: bull,
        borderDownColor: bear,
        wickUpColor: bull,
        wickDownColor: bear,
      });
      candleSeries.setData(
        candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
      if (candles.some((c) => c.volume != null)) {
        const vol = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "vol",
        });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        vol.setData(
          candles.map((c) => ({
            time: c.time,
            value: c.volume ?? 0,
            color: c.close >= c.open ? `${bull}55` : `${bear}55`,
          }))
        );
      }
      if (sma && sma.some((v) => v != null)) {
        const line = chart.addLineSeries({
          color: info,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          title: "SMA 20",
        });
        line.setData(
          candles.flatMap((c, i) => (sma[i] == null ? [] : [{ time: c.time, value: sma[i] as number }]))
        );
      }
      const ideaLines = levels.filter((lv) => lv.title.startsWith("idea "));
      const other = levels.filter((lv) => !lv.title.startsWith("idea "));
      const drawn = [...ideaLines, ...other.slice(0, 8)];
      const seen = new Set<string>();
      for (const lv of drawn) {
        const key = `${lv.title}:${lv.price}`;
        if (seen.has(key) || !Number.isFinite(lv.price)) continue;
        seen.add(key);
        candleSeries.createPriceLine({
          price: lv.price,
          color: resolveColor(lv.color),
          lineWidth: 1,
          lineStyle: lv.dashed ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title: lv.title,
        });
      }
      chart.timeScale().fitContent();
      ro = new ResizeObserver(() => {
        if (!chart || !wrap.current) return;
        chart.resize(wrap.current.clientWidth, height);
      });
      ro.observe(el);
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      chart?.remove();
    };
  }, [candles, sma, levels, height, theme]);

  if (candles.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs font-terminal text-[var(--text-muted)]" style={{ height }}>
        No candles
      </div>
    );
  }
  return <div ref={wrap} className="w-full" style={{ height }} />;
}
