"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { toVelaBars, velaTimeframe, type DeskCandle } from "@/lib/chart/velaBars";

export type Candle = DeskCandle;

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
  interval?: "1d" | "5m";
  symbol?: string;
};

type SmaHandle = {
  remove(): void;
  setInputs(values: Record<string, string | number>): void;
};

type VelaChart = {
  ready(): Promise<void>;
  destroy(): void;
  resize(): void;
  setMarket(next: { data?: unknown; timeframe?: string; symbol?: string }): Promise<void>;
  setTheme(theme: unknown): unknown;
  addNativeIndicator(
    type: string,
    options?: { inputs?: Record<string, string | number> }
  ): SmaHandle;
  drawings: {
    add(
      type: string,
      init?: {
        anchors?: Array<{ time: number; price: number }>;
        style?: { lineColor?: string; lineWidth?: number; lineStyle?: string };
        text?: { value: string; size: string; hAlign: string; vAlign: string };
      }
    ): { id: string } | null;
    remove(id: string): void;
    lock(id: string, v?: boolean): void;
  };
  renderer: { set(key: string, value: unknown): void };
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

function readTheme() {
  return {
    background: cssVar("--card-bg", "#0d1117"),
    textColor: cssVar("--text-secondary", "#9ca3af"),
    gridColor: cssVar("--border", "#1e2733"),
    borderColor: cssVar("--border", "#1e2733"),
    upColor: cssVar("--accent-bull", "#00ff88"),
    downColor: cssVar("--accent-bear", "#ff3366"),
    fontFamily: "JetBrains Mono, monospace",
  };
}

function glowForTheme(theme: string) {
  return theme === "paper" ? 0 : 0.35;
}

const DRAW_TOOLS = [
  "trendline",
  "hline",
  "ray",
  "extendedline",
  "box",
  "fibretracement",
  "text",
  "pricelabel",
] as const;

function pickLevels(levels: ChartLevel[]): ChartLevel[] {
  const ideaLines = levels.filter((lv) => lv.title.startsWith("idea "));
  const other = levels.filter((lv) => !lv.title.startsWith("idea "));
  const drawn = [...ideaLines, ...other.slice(0, 8)];
  const seen = new Set<string>();
  const out: ChartLevel[] = [];
  for (const lv of drawn) {
    const key = `${lv.title}:${lv.price}`;
    if (seen.has(key) || !Number.isFinite(lv.price)) continue;
    seen.add(key);
    out.push(lv);
  }
  return out;
}

function applySkin(chart: VelaChart, themeName: string) {
  const skin = readTheme();
  const glow = glowForTheme(themeName);
  chart.setTheme(themeName === "paper" ? "light" : "dark");
  chart.setTheme(skin);
  chart.renderer.set("upColor", skin.upColor);
  chart.renderer.set("downColor", skin.downColor);
  chart.renderer.set("glow", glow);
  return { skin, glow };
}

function applySma(chart: VelaChart, sma: (number | null)[] | undefined, handle: { current: SmaHandle | null }) {
  const wantSma = Boolean(sma && sma.some((v) => v != null));
  const info = cssVar("--accent-info", "#00aaff");
  if (wantSma && !handle.current) {
    handle.current = chart.addNativeIndicator("sma", { inputs: { length: 20, color: info } });
  } else if (!wantSma && handle.current) {
    handle.current.remove();
    handle.current = null;
  } else if (wantSma && handle.current) {
    handle.current.setInputs({ length: 20, color: info });
  }
}

function applyLevels(chart: VelaChart, bars: { time: number }[], levels: ChartLevel[], ids: string[]) {
  for (const id of ids) {
    try {
      chart.drawings.remove(id);
    } catch {
      /* already gone */
    }
  }
  ids.length = 0;
  if (bars.length === 0) return;
  const t = bars[bars.length - 1].time;
  for (const lv of pickLevels(levels)) {
    const d = chart.drawings.add("hline", {
      anchors: [{ time: t, price: lv.price }],
      style: {
        lineColor: resolveColor(lv.color),
        lineWidth: 1,
        lineStyle: lv.dashed ? "dashed" : "solid",
      },
      text: { value: lv.title, size: "tiny", hAlign: "left", vAlign: "center" },
    });
    if (!d) continue;
    try {
      chart.drawings.lock(d.id, true);
    } catch {
      /* lock is best-effort — the hline still paints */
    }
    ids.push(d.id);
  }
}

export function VelaCredit({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://luxalgo.com/vela"
      target="_blank"
      rel="noopener noreferrer"
      className={`text-[10px] font-terminal tracking-widest text-[var(--text-muted)] hover:text-[var(--accent-info)] ${className}`}
    >
      Vela™
    </a>
  );
}

export function TradingChart({
  candles,
  sma,
  levels,
  height = 460,
  interval = "1d",
  symbol,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const chartRef = useRef<VelaChart | null>(null);
  const smaRef = useRef<SmaHandle | null>(null);
  const levelIdsRef = useRef<string[]>([]);
  const latest = useRef({ candles, sma, levels, interval, symbol, height, theme: "neon" });
  const { theme } = useTheme();
  latest.current = { candles, sma, levels, interval, symbol, height, theme };
  const hasData = candles.length >= 2;

  useEffect(() => {
    const el = wrap.current;
    if (!el || !hasData) return;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let chart: VelaChart | null = null;

    const sync = async (instance: VelaChart) => {
      const cur = latest.current;
      const bars = toVelaBars(cur.candles);
      if (bars.length < 2) return;
      applySkin(instance, cur.theme);
      await instance.setMarket({
        data: bars,
        timeframe: velaTimeframe(cur.interval),
        symbol: cur.symbol,
      });
      applySma(instance, cur.sma, smaRef);
      applyLevels(instance, bars, cur.levels, levelIdsRef.current);
      instance.resize();
    };

    (async () => {
      const { Vela } = await import("@luxalgo/vela");
      if (disposed || !wrap.current) return;
      const bars = toVelaBars(latest.current.candles);
      if (bars.length < 2) return;
      const { skin, glow } = { skin: readTheme(), glow: glowForTheme(latest.current.theme) };
      chart = new Vela(el, {
        data: bars,
        symbol: latest.current.symbol,
        timeframe: velaTimeframe(latest.current.interval),
        theme: skin,
        height: latest.current.height,
        nativeBackend: "auto",
        currentPriceLine: true,
        volume: true,
        live: false,
        glow,
        upColor: skin.upColor,
        downColor: skin.downColor,
        drawings: { toolbar: true, tools: [...DRAW_TOOLS] },
      }) as unknown as VelaChart;
      await chart.ready();
      if (disposed) {
        chart.destroy();
        return;
      }
      chartRef.current = chart;
      await sync(chart);
      if (disposed) return;
      ro = new ResizeObserver(() => chartRef.current?.resize());
      ro.observe(el);
    })().catch((err) => {
      console.error("Vela chart failed to mount", err);
    });

    return () => {
      disposed = true;
      ro?.disconnect();
      smaRef.current = null;
      levelIdsRef.current = [];
      chartRef.current = null;
      chart?.destroy();
    };
  }, [hasData]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !hasData) return;
    const bars = toVelaBars(candles);
    if (bars.length < 2) return;
    applySkin(chart, theme);
    void chart
      .setMarket({
        data: bars,
        timeframe: velaTimeframe(interval),
        symbol,
      })
      .then(() => {
        if (chartRef.current !== chart) return;
        applySma(chart, sma, smaRef);
        applyLevels(chart, bars, levels, levelIdsRef.current);
        chart.resize();
      })
      .catch((err) => {
        console.error("Vela setMarket failed", err);
      });
  }, [candles, sma, levels, interval, symbol, hasData, theme]);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center text-xs font-terminal text-[var(--text-muted)]" style={{ height }}>
        No candles
      </div>
    );
  }
  return <div ref={wrap} className="vela-host w-full" style={{ height }} />;
}
