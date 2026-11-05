import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { finiteNumber } from "@/lib/adjustOhlc";
import {
  classifyDailySetup,
  detectPhase3Triggers,
  mergeDailyRibbonOn5m,
  type Phase3Trigger,
} from "@/lib/ema200Intraday";
import { selectScanUniverse } from "@/lib/ema200ScanSelect";
import { classifyEma200Setup, type Ema200FeatureRow } from "@/lib/ema200Watchlist";
import { fetchYahooDaily } from "@/lib/yahooDaily";
import { fetchYahooIntraday } from "@/lib/yahooIntraday";
import { parseSymbolsQueryParam } from "@/lib/symbolsQuery";
import { resolveUniverseDesk } from "@/lib/resolveIndexDesk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type FeatureDbRow = {
  symbol: string;
  bar_date: string;
  close: number | null;
  ema200: number | null;
  ema200_high: number | null;
  dist_atr: number | null;
  ribbon_dist_atr: number | null;
  days_above: number | null;
  ema200_slope: number | null;
  rvol: number | null;
};

function coerceFeature(r: FeatureDbRow): FeatureDbRow {
  return {
    ...r,
    bar_date: String(r.bar_date).slice(0, 10),
    close: finiteNumber(r.close),
    ema200: finiteNumber(r.ema200),
    ema200_high: finiteNumber(r.ema200_high),
    dist_atr: finiteNumber(r.dist_atr),
    ribbon_dist_atr: finiteNumber(r.ribbon_dist_atr),
    days_above: finiteNumber(r.days_above),
    ema200_slope: finiteNumber(r.ema200_slope),
    rvol: finiteNumber(r.rvol),
  };
}

async function dailyBarsForSymbol(sb: ReturnType<typeof createServerClient>, symbol: string) {
  const { data } = await sb
    .from("prices_daily")
    .select("date, open, high, low, close, adj_close, volume")
    .eq("symbol", symbol)
    .order("date", { ascending: true });
  const rows = data ?? [];
  if (rows.length >= 400) {
    return rows.map((r) => ({
      date: String(r.date).slice(0, 10),
      open: Number(r.open ?? r.close),
      high: Number(r.high ?? r.close),
      low: Number(r.low ?? r.close),
      close: Number(r.adj_close ?? r.close),
      volume: Number(r.volume ?? 0),
    }));
  }
  const yahoo = await fetchYahooDaily(symbol, "10y");
  return yahoo.map((b) => ({
    date: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(parseInt(sp.get("limit") ?? "40", 10), 80);
    const sb = createServerClient();
    const watchlistInput = parseSymbolsQueryParam(sp.get("symbols"));
    const resolved = await resolveUniverseDesk(sb, sp.get("universe"), watchlistInput);
    const deskSymbols =
      resolved.desk === "watchlist" && resolved.symbols.length > 0 ? resolved.symbols : [];

    let features: FeatureDbRow[] = [];
    try {
      features = await fetchAll<FeatureDbRow>(
        sb,
        "ema200_features",
        "symbol, bar_date, close, ema200, ema200_high, dist_atr, ribbon_dist_atr, days_above, ema200_slope, rvol"
      );
    } catch {
      features = [];
    }

    features = features.map(coerceFeature);
    const scan = selectScanUniverse(features);
    const latestBySym = new Map(scan.latest.map((r) => [r.symbol, r]));

    let symbols: string[] = [];
    if (deskSymbols.length) {
      symbols = deskSymbols;
    } else {
      for (const [sym, row] of Array.from(latestBySym.entries())) {
        const feat: Ema200FeatureRow = {
          symbol: sym,
          close: row.close,
          ema200: row.ema200,
          ema200_high: row.ema200_high,
          dist_atr: row.dist_atr,
          ribbon_dist_atr: row.ribbon_dist_atr,
          days_above: row.days_above,
          ema200_slope: row.ema200_slope,
        };
        if (classifyEma200Setup(feat)) symbols.push(sym);
      }
    }
    symbols = symbols.slice(0, limit);

    const triggers: Phase3Trigger[] = [];
    const errors: { symbol: string; error: string }[] = [];

    for (const sym of symbols) {
      try {
        const featRow = latestBySym.get(sym);
        const dailySetup = featRow
          ? classifyDailySetup({
              symbol: sym,
              close: featRow.close,
              ema200: featRow.ema200,
              ema200_high: featRow.ema200_high,
              dist_atr: featRow.dist_atr,
              ribbon_dist_atr: featRow.ribbon_dist_atr,
              days_above: featRow.days_above,
              ema200_slope: featRow.ema200_slope,
            })
          : null;
        const [bars5, daily] = await Promise.all([fetchYahooIntraday(sym), dailyBarsForSymbol(sb, sym)]);
        if (bars5.length < 20 || daily.length < 200) continue;
        const merged = mergeDailyRibbonOn5m(
          bars5.map((b) => ({
            time: b.time,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
          })),
          daily
        );
        triggers.push(...detectPhase3Triggers(sym, merged, dailySetup));
      } catch (e) {
        errors.push({ symbol: sym, error: e instanceof Error ? e.message : "scan failed" });
      }
    }

    triggers.sort((a, b) => b.score - a.score);

    return NextResponse.json({
      phase: 3,
      mode: "intraday_confirm",
      asOfDate: scan.asOfDate,
      disclaimer:
        "Phase 3: 5m bar-close triggers vs the daily EMA200 ribbon (Yahoo delayed). RECLAIM requires EOD RETRACE_HELD. Detect/log only — no orders.",
      dataSource: "yahoo_5m+prices_daily",
      triggers,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    console.error("EMA200 intraday API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
