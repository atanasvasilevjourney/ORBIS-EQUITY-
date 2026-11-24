import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { isMissingRelation } from "@/lib/supabase/errors";
import { fetchYahooDaily } from "@/lib/yahooDaily";
import { scanTrendBandFromCandles, type TrendBandHit, type TrendBandSparkBar } from "@/lib/trendBandPullback";
import type { Candle } from "@/components/chart/TradingChart";

export const revalidate = 900;
export const maxDuration = 60;

const DISCLAIMER =
  "Trend-band pullback is a discretionary heuristic (EMA 20/50 cloud). Not investment advice. " +
  "Invalidate on a daily close below the band low. Nightly scan uses LOOP universe + sector/commodity ETFs; " +
  "live fallback uses a capped Yahoo sample when DB tables are empty.";

type DbRow = {
  symbol: string;
  bar_date: string;
  setup_kind: string;
  score: number | null;
  close: number | null;
  band_lo: number | null;
  band_hi: number | null;
  invalidation: number | null;
  dist_to_band_pct: number | null;
  pullback_pct: number | null;
  advance_pct: number | null;
  band_slope_pct: number | null;
  band_color: string | null;
  band_flip: boolean | null;
  days_since_flip: number | null;
  spark: TrendBandSparkBar[] | null;
};

export type TrendBandApiRow = {
  symbol: string;
  barDate: string;
  setupKind: string;
  score: number | null;
  close: number | null;
  bandLo: number | null;
  bandHi: number | null;
  invalidation: number | null;
  distToBandPct: number | null;
  pullbackPct: number | null;
  advancePct: number | null;
  bandSlopePct: number | null;
  bandColor: string | null;
  bandFlip: boolean;
  daysSinceFlip: number | null;
  spark: TrendBandSparkBar[];
  emaFast: number;
  emaSlow: number;
  companyName: string;
};

function mapRow(r: DbRow, names: Map<string, string>, hit?: TrendBandHit): TrendBandApiRow {
  return {
    symbol: r.symbol,
    barDate: r.bar_date,
    setupKind: r.setup_kind,
    score: r.score,
    close: r.close,
    bandLo: r.band_lo,
    bandHi: r.band_hi,
    invalidation: r.invalidation,
    distToBandPct: r.dist_to_band_pct,
    pullbackPct: r.pullback_pct,
    advancePct: r.advance_pct,
    bandSlopePct: r.band_slope_pct,
    bandColor: r.band_color,
    bandFlip: Boolean(r.band_flip),
    daysSinceFlip: r.days_since_flip,
    spark: (r.spark as TrendBandSparkBar[]) ?? hit?.spark ?? [],
    emaFast: hit?.emaFast ?? 20,
    emaSlow: hit?.emaSlow ?? 50,
    companyName: names.get(r.symbol) ?? r.symbol,
  };
}

async function liveScanSample(symbols: string[], limit: number): Promise<TrendBandApiRow[]> {
  const out: TrendBandApiRow[] = [];
  for (const sym of symbols.slice(0, limit)) {
    const bars = await fetchYahooDaily(sym, "2y");
    if (bars.length < 80) continue;
    const candles: Candle[] = bars.map((b) => ({
      time: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    const hit = scanTrendBandFromCandles(candles);
    if (!hit) continue;
    out.push({
      symbol: sym,
      barDate: String(bars[bars.length - 1]?.date ?? "").slice(0, 10),
      setupKind: hit.setupKind,
      score: hit.score,
      close: hit.close,
      bandLo: hit.bandLo,
      bandHi: hit.bandHi,
      invalidation: hit.invalidation,
      distToBandPct: hit.distToBandPct,
      pullbackPct: hit.pullbackPct,
      advancePct: hit.advancePct,
      bandSlopePct: hit.bandSlopePct,
      bandColor: hit.bandColor,
      bandFlip: hit.bandFlip,
      daysSinceFlip: hit.daysSinceFlip,
      spark: hit.spark,
      emaFast: hit.emaFast,
      emaSlow: hit.emaSlow,
      companyName: sym,
    });
  }
  out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return out;
}

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const flipOnly = req.nextUrl.searchParams.get("flip") === "1";

  try {
    const sb = createServerClient();
    let rows: DbRow[] = [];
    let run: { asof_date: string; headline: string | null; names: number | null } | null = null;

    try {
      const runs = await fetchAll<{ asof_date: string; headline: string | null; names: number | null }>(
        sb,
        "trend_band_scan_runs",
        "asof_date, headline, names"
      );
      run = runs.sort((a, b) => b.asof_date.localeCompare(a.asof_date))[0] ?? null;
      const barDate = run?.asof_date;
      if (barDate) {
        rows = await fetchAll<DbRow>(
          sb,
          "trend_band_setups",
          "symbol, bar_date, setup_kind, score, close, band_lo, band_hi, invalidation, dist_to_band_pct, pullback_pct, advance_pct, band_slope_pct, band_color, band_flip, days_since_flip, spark",
          (q) => q.eq("bar_date", barDate)
        );
      }
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }

    const uni = await fetchAll<{ symbol: string; company_name: string | null }>(
      sb,
      "universe_members",
      "symbol, company_name"
    );
    const names = new Map(uni.map((u) => [u.symbol, u.company_name ?? u.symbol]));

    let dataSource = "trend_band_setups";
    let mapped: TrendBandApiRow[] = rows.map((r) => mapRow(r, names));

    if (!mapped.length) {
      dataSource = "live_yahoo";
      const syms = [
        ...new Set([
          ...uni.map((u) => u.symbol),
          "USO",
          "XLE",
          "XLV",
          "AZN",
          "SPY",
          "QQQ",
        ]),
      ];
      mapped = await liveScanSample(syms, 45);
    }

    if (kind && kind !== "all") {
      mapped = mapped.filter((r) => r.setupKind === kind);
    }
    if (flipOnly) {
      mapped = mapped.filter((r) => r.bandFlip);
    }
    mapped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return NextResponse.json({
      asOfDate: run?.asof_date ?? mapped[0]?.barDate ?? null,
      headline: run?.headline ?? (mapped.length ? `${mapped.length} live trend-band hits (sample)` : null),
      names: mapped.length,
      rows: mapped,
      dataSource,
      disclaimer: DISCLAIMER,
      band: { emaFast: 20, emaSlow: 50, note: "Green cloud when mid-band rises ≥0.02% over 5 bars and fast≥slow." },
    });
  } catch (err) {
    console.error("[trend-band]", err);
    return NextResponse.json(
      { rows: [], disclaimer: DISCLAIMER, error: "fetch_failed" },
      { status: 500 }
    );
  }
}