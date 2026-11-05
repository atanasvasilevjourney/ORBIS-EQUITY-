import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { dailyRibbonSwingLines } from "@/lib/ema200Intraday";
import { scaleOhlc } from "@/lib/adjustOhlc";
import { projectSwing } from "@/lib/chartEma";
import { rateLimitAllowed } from "@/lib/rateLimit";
import { vwapOverlaysForIntraday } from "@/lib/vwap";
import { fetchYahooDaily } from "@/lib/yahooDaily";
import { fetchYahooIntraday } from "@/lib/yahooIntraday";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Candle = { time: string | number; open: number; high: number; low: number; close: number; volume?: number };

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i];
    if (i >= period) acc -= values[i - period];
    out.push(i >= period - 1 ? acc / period : null);
  }
  return out;
}

function clampBar(o: number, h: number, l: number, c: number, vol?: number, time?: string | number): Candle | null {
  if (![o, h, l, c].every(Number.isFinite)) return null;
  const high = Math.max(h, o, c);
  const low = Math.min(l, o, c);
  if (low > high) return null;
  return { time: time as string | number, open: o, high, low, close: c, volume: vol };
}

async function loadDailyOhlc(sb: ReturnType<typeof createServerClient>, ticker: string) {
  const { data } = await sb
    .from("prices_daily")
    .select("date, open, high, low, close, adj_close, volume")
    .eq("symbol", ticker)
    .order("date", { ascending: true });
  const rows = data ?? [];
  if (rows.length >= 400) {
    return rows.map((r) => {
      const close = Number(r.close);
      const scaled = scaleOhlc(
        {
          open: Number(r.open ?? r.close),
          high: Number(r.high ?? r.close),
          low: Number(r.low ?? r.close),
          close,
        },
        r.adj_close == null ? close : Number(r.adj_close)
      );
      return {
        date: String(r.date).slice(0, 10),
        open: scaled.open,
        high: scaled.high,
        low: scaled.low,
        close: scaled.close,
        volume: Number(r.volume ?? 0),
      };
    });
  }
  const yahoo = await fetchYahooDaily(ticker, "10y");
  return yahoo.map((b) => ({
    date: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params.ticker || "").toUpperCase();
  if (!/^[A-Z0-9.\-]{1,20}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimitAllowed(`chart:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  const requested = req.nextUrl.searchParams.get("interval") === "5m" ? "5m" : "1d";

  try {
    if (requested === "5m") {
      const sb = createServerClient();
      const raw = await fetchYahooIntraday(ticker);
      const candles: Candle[] = raw
        .map((b) => clampBar(b.open, b.high, b.low, b.close, b.volume, b.time))
        .filter((c): c is Candle => c != null);
      if (candles.length >= 20) {
        const daily = await loadDailyOhlc(sb, ticker);
        const ribbon =
          daily.length >= 200
            ? dailyRibbonSwingLines(
                candles.map((c) => ({
                  time: c.time,
                  open: c.open,
                  high: c.high,
                  low: c.low,
                  close: c.close,
                  volume: c.volume,
                })),
                daily
              )
            : null;
        const { session, anchored, anchorLabel } = vwapOverlaysForIntraday(candles);
        return NextResponse.json({
          ticker,
          interval: "5m",
          source: "yahoo",
          delayed: true,
          ribbonAnchor: "daily_ema200_eod",
          candles,
          vwapSession: session,
          vwapAnchored: anchored,
          vwapAnchorLabel: anchorLabel,
          swing: ribbon
            ? {
                ema200: ribbon.ema200,
                ema200High: ribbon.ema200High,
              }
            : undefined,
        });
      }
    }

    const sb = createServerClient();
    const { data, error } = await sb
      .from("prices_daily")
      .select("date, open, high, low, close, adj_close, volume")
      .eq("symbol", ticker)
      .order("date", { ascending: false })
      .limit(2000);
    if (error) {
      console.error("chart query", error);
      return NextResponse.json({
        ticker,
        interval: "1d",
        source: "prices_daily",
        candles: [],
        sma20: [],
        fallbackFrom5m: requested === "5m",
      });
    }
    let candles: Candle[] = (data ?? [])
      .map((r) => {
        const close = Number(r.close);
        const scaled = scaleOhlc(
          {
            open: Number(r.open ?? r.close),
            high: Number(r.high ?? r.close),
            low: Number(r.low ?? r.close),
            close,
          },
          r.adj_close == null ? close : Number(r.adj_close)
        );
        return clampBar(
          scaled.open,
          scaled.high,
          scaled.low,
          scaled.close,
          r.volume != null ? Number(r.volume) : undefined,
          String(r.date).slice(0, 10)
        );
      })
      .filter((c): c is Candle => c != null)
      .reverse();
    let source = "prices_daily";
    // Short stored history reseeds EMA200. Prefer a long adjusted Yahoo series.
    if (candles.length < 1200) {
      const yahoo = await fetchYahooDaily(ticker, "10y");
      const fromYahoo = yahoo
        .map((b) => clampBar(b.open, b.high, b.low, b.close, b.volume, b.date))
        .filter((c): c is Candle => c != null);
      if (fromYahoo.length > candles.length) {
        candles = fromYahoo;
        source = "yahoo_eod";
      }
    }
    const projected = projectSwing(candles, 400);
    const view = projected.candles;
    const closes = view.map((c) => c.close);
    return NextResponse.json({
      ticker,
      interval: "1d",
      source,
      delayed: source === "yahoo_eod",
      candles: view,
      sma20: sma(closes, 20),
      swing: projected.swing,
      fallbackFrom5m: requested === "5m",
    });
  } catch (err) {
    console.error("Chart API error:", err);
    return NextResponse.json({
      ticker,
      interval: requested,
      source: "none",
      candles: [],
      sma20: [],
    });
  }
}
