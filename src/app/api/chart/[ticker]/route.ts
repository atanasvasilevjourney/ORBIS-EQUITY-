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

async function yahoo5m(ticker: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=5d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 KovaView-Terminal" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = await res.json();
  const result = body?.chart?.result?.[0];
  const ts: number[] = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0] ?? {};
  const out: Candle[] = [];
  let lastTs = -1;
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (ts[i] <= lastTs) continue;
    lastTs = ts[i];
    out.push({
      time: ts[i],
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
      volume: q.volume?.[i] != null ? Number(q.volume[i]) : undefined,
    });
  }
  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params.ticker || "").toUpperCase();
  if (!/^[A-Z0-9.\-]{1,20}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const interval = req.nextUrl.searchParams.get("interval") === "5m" ? "5m" : "1d";

  try {
    if (interval === "5m") {
      const candles = await yahoo5m(ticker);
      if (candles.length >= 20) {
        const closes = candles.map((c) => c.close);
        return NextResponse.json({
          ticker,
          interval: "5m",
          source: "yahoo",
          candles,
          sma20: sma(closes, 20),
        });
      }
    }

    const sb = createServerClient();
    const { data, error } = await sb
      .from("prices_daily")
      .select("date, open, high, low, close, volume")
      .eq("symbol", ticker)
      .order("date", { ascending: true })
      .limit(400);
    if (error) {
      console.error("chart query", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    const candles: Candle[] = (data ?? [])
      .filter((r) => r.close != null)
      .map((r) => ({
        time: String(r.date).slice(0, 10),
        open: Number(r.open ?? r.close),
        high: Number(r.high ?? r.close),
        low: Number(r.low ?? r.close),
        close: Number(r.close),
        volume: r.volume != null ? Number(r.volume) : undefined,
      }));
    const closes = candles.map((c) => c.close);
    return NextResponse.json({
      ticker,
      interval: "1d",
      source: "prices_daily",
      candles,
      sma20: sma(closes, 20),
    });
  } catch (err) {
    console.error("Chart API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
