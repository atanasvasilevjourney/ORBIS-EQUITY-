"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { withAlpha } from "@/lib/chartColors";

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

/** Sloped or multi-point overlays (triangle trendlines, channels). */
export type ChartSegment = {
  points: { time: string | number; price: number }[];
  title?: string;
  color: string;
  dashed?: boolean;
};

export type SwingEmaLines = {
  ema49?: (number | null)[];
  ema50?: (number | null)[];
  ema200?: (number | null)[];
  ema200High?: (number | null)[];
};

type Props = {
  candles: Candle[];
  sma?: (number | null)[];
  /** EMA49/50 + double EMA200 ribbon (daily swing context). */
  swing?: SwingEmaLines;
  /** Session VWAP (5m / intraday; resets each US/Eastern day). */
  vwapSession?: (number | null)[];
  /** Anchored VWAP (5m; week anchor in ET by default from API). */
  vwapAnchored?: (number | null)[];
  levels: ChartLevel[];
  /** Pattern geometry (triangle legs, channels) drawn as line series. */
  segments?: ChartSegment[];
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

function levelsKey(levels: ChartLevel[]) {
  return levels
    .map((lv) => `${lv.title}:${lv.price}:${lv.color}:${lv.dashed ? 1 : 0}`)
    .join("|");
}

function lineOverlayData(candles: Candle[], values: (number | null)[]) {
  return candles.flatMap((c, i) => (values[i] == null ? [] : [{ time: c.time as never, value: values[i] as number }]));
}

export function TradingChart({
  candles,
  sma,
  swing,
  vwapSession,
  vwapAnchored,
  levels,
  segments,
  height = 420,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);
  const seriesRef = useRef<ReturnType<
    ReturnType<typeof import("lightweight-charts").createChart>["addCandlestickSeries"]
  > | null>(null);
  const priceLinesRef = useRef<unknown[]>([]);
  const { theme } = useTheme();
  const levelsSig = levelsKey(levels);
  const [chartReady, setChartReady] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el || candles.length < 2) return;

    setChartReady(0);
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let raf = 0;

    const mount = async () => {
      const width = el.clientWidth;
      if (width < 8) {
        raf = requestAnimationFrame(() => void mount());
        return;
      }

      const { createChart, ColorType, LineStyle, CrosshairMode } = await import("lightweight-charts");
      if (disposed || !wrap.current) return;

      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];

      const bull = cssVar("--accent-bull", "#00ff88");
      const bear = cssVar("--accent-bear", "#ff3366");
      const info = cssVar("--accent-info", "#00aaff");
      const text = cssVar("--text-secondary", "#9ca3af");
      const grid = cssVar("--border", "#1e2733");
      const bg = cssVar("--card-bg", "#0d1117");

      const chart = createChart(el, {
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
        timeScale: {
          borderColor: grid,
          timeVisible: typeof candles[0].time === "number",
          secondsVisible: false,
        },
      });
      chartRef.current = chart;

      const candleSeries = chart.addCandlestickSeries({
        upColor: bull,
        downColor: bear,
        borderUpColor: bull,
        borderDownColor: bear,
        wickUpColor: bull,
        wickDownColor: bear,
      });
      seriesRef.current = candleSeries;

      candleSeries.setData(
        candles.map((c) => ({
          time: c.time as never,
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
            time: c.time as never,
            value: c.volume ?? 0,
            color: c.close >= c.open ? withAlpha(bull, 0.35) : withAlpha(bear, 0.35),
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
        line.setData(lineOverlayData(candles, sma));
      }

      const warn = cssVar("--accent-warning", "#ffaa00");
      const violet = cssVar("--accent-violet", "#b388ff");
      if (swing?.ema50?.some((v) => v != null)) {
        const line = chart.addLineSeries({
          color: warn,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "EMA 50",
        });
        line.setData(lineOverlayData(candles, swing.ema50));
      }
      if (swing?.ema49?.some((v) => v != null)) {
        const line = chart.addLineSeries({
          color: violet,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          title: "EMA 49",
        });
        line.setData(lineOverlayData(candles, swing.ema49));
      }
      if (swing?.ema200?.some((v) => v != null)) {
        const line = chart.addLineSeries({
          color: info,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "EMA 200",
        });
        line.setData(lineOverlayData(candles, swing.ema200));
      }
      if (swing?.ema200High?.some((v) => v != null)) {
        const line = chart.addLineSeries({
          color: info,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "EMA 200 hi",
        });
        line.setData(lineOverlayData(candles, swing.ema200High));
      }

      if (vwapSession && vwapSession.some((v) => v != null)) {
        const line = chart.addLineSeries({
          color: warn,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "VWAP",
        });
        line.setData(lineOverlayData(candles, vwapSession));
      }
      if (vwapAnchored && vwapAnchored.some((v) => v != null)) {
        const line = chart.addLineSeries({
          color: violet,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "AVWAP",
        });
        line.setData(lineOverlayData(candles, vwapAnchored));
      }

      for (const seg of segments ?? []) {
        if (!seg.points?.length) continue;
        const line = chart.addLineSeries({
          color: resolveColor(seg.color),
          lineWidth: 2,
          lineStyle: seg.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          title: seg.title ?? "pattern",
        });
        line.setData(
          seg.points.map((p) => ({
            time: p.time as never,
            value: p.price,
          }))
        );
      }

      chart.timeScale().fitContent();
      setChartReady((n) => n + 1);

      ro = new ResizeObserver(() => {
        if (!chartRef.current || !wrap.current) return;
        const w = wrap.current.clientWidth;
        if (w >= 8) chartRef.current.resize(w, height);
      });
      ro.observe(el);
    };

    void mount();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      if (seriesRef.current) {
        for (const pl of priceLinesRef.current) {
          seriesRef.current.removePriceLine(pl as never);
        }
      }
      priceLinesRef.current = [];
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [candles, sma, swing, vwapSession, vwapAnchored, segments, height, theme]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length < 2 || chartReady === 0) return;

    (async () => {
      const { LineStyle } = await import("lightweight-charts");
      if (seriesRef.current) {
        for (const pl of priceLinesRef.current) {
          seriesRef.current.removePriceLine(pl as never);
        }
      }
      priceLinesRef.current = [];

      const ideaLines = levels.filter((lv) => lv.title.startsWith("idea "));
      const other = levels.filter((lv) => !lv.title.startsWith("idea "));
      const drawn = [...ideaLines, ...other.slice(0, 8)];
      const seen = new Set<string>();
      for (const lv of drawn) {
        const key = `${lv.title}:${lv.price}`;
        if (seen.has(key) || !Number.isFinite(lv.price)) continue;
        seen.add(key);
        const line = series.createPriceLine({
          price: lv.price,
          color: resolveColor(lv.color),
          lineWidth: 1,
          lineStyle: lv.dashed ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title: lv.title,
        });
        priceLinesRef.current.push(line);
      }
    })();
  }, [levelsSig, levels, candles.length, theme, chartReady]);

  if (candles.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs font-terminal text-[var(--text-muted)]" style={{ height }}>
        No candles
      </div>
    );
  }
  return <div ref={wrap} className="w-full min-w-0" style={{ height }} />;
}
