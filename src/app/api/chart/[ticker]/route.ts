import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

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

async function yahoo5m(ticker: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=5d&includePrePost=false`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 OrbisEquity-Terminal" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    const result = body?.chart?.result?.[0];
    const ts: number[] = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0] ?? {};
    const out: Candle[] = [];
    let lastTs = -1;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] <= lastTs) continue;
      const bar = clampBar(
        Number(q.open?.[i]),
        Number(q.high?.[i]),
        Number(q.low?.[i]),
        Number(q.close?.[i]),
        q.volume?.[i] != null ? Number(q.volume[i]) : undefined,
        ts[i]
      );
      if (!bar) continue;
      lastTs = ts[i];
      out.push(bar);
    }
    return out;
  } catch {
    return [];
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params.ticker || "").toUpperCase();
  if (!/^[A-Z0-9.\-]{1,20}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const requested = req.nextUrl.searchParams.get("interval") === "5m" ? "5m" : "1d";

  try {
    if (requested === "5m") {
      const candles = await yahoo5m(ticker);
      if (candles.length >= 20) {
        return NextResponse.json({
          ticker,
          interval: "5m",
          source: "yahoo",
          candles,
        });
      }
    }

    const sb = createServerClient();
    const { data, error } = await sb
      .from("prices_daily")
      .select("date, open, high, low, close, volume")
      .eq("symbol", ticker)
      .order("date", { ascending: false })
      .limit(400);
    if (error) {
      console.error("chart query", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    const candles: Candle[] = (data ?? [])
      .map((r) =>
        clampBar(
          Number(r.open ?? r.close),
          Number(r.high ?? r.close),
          Number(r.low ?? r.close),
          Number(r.close),
          r.volume != null ? Number(r.volume) : undefined,
          String(r.date).slice(0, 10)
        )
      )
      .filter((c): c is Candle => c != null)
      .reverse();
    const closes = candles.map((c) => c.close);
    return NextResponse.json({
      ticker,
      interval: "1d",
      source: "prices_daily",
      candles,
      sma20: sma(closes, 20),
      fallbackFrom5m: requested === "5m",
    });
  } catch (err) {
    console.error("Chart API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
