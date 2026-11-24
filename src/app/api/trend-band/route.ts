import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { isMissingRelation } from "@/lib/supabase/errors";
import { fetchYahooDaily } from "@/lib/yahooDaily";
import {
  scanBothTimeframes,
  type PbEmaSparkBar,
  type TrendBandHit,
  PB_EMA_DEFAULTS,
} from "@/lib/trendBandPullback";

export const revalidate = 900;
export const maxDuration = 60;

const DISCLAIMER =
  "pb_ema EMA200 band (high/low) pullback scan on daily and weekly. Heuristic only — not a trade signal. " +
  "Invalidate on close below EMA200-of-lows. Weekly needs ~220+ completed weeks (~5y+ daily history). " +
  "Nightly uses ema200_universe + index/crypto supplements; live fallback is capped.";

type DbRow = {
  symbol: string;
  bar_date: string;
  timeframe: string;
  asset_class: string | null;
  setup_kind: string;
  score: number | null;
  close: number | null;
  band_lo: number | null;
  band_hi: number | null;
  ema200_high: number | null;
  ema200_low: number | null;
  invalidation: number | null;
  dist_to_band_pct: number | null;
  pullback_pct: number | null;
  advance_pct: number | null;
  band_slope_pct: number | null;
  band_color: string | null;
  band_flip: boolean | null;
  days_since_flip: number | null;
  dual_timeframe: boolean | null;
  spark: PbEmaSparkBar[] | null;
};

export type TrendBandApiRow = {
  symbol: string;
  barDate: string;
  timeframes: string[];
  assetClass: string;
  setupKind: string;
  score: number | null;
  close: number | null;
  bandLo: number | null;
  bandHi: number | null;
  ema200High: number | null;
  ema200Low: number | null;
  invalidation: number | null;
  distToBandPct: number | null;
  pullbackPct: number | null;
  advancePct: number | null;
  bandSlopePct: number | null;
  bandColor: string | null;
  bandFlip: boolean;
  daysSinceFlip: number | null;
  dualTimeframe: boolean;
  spark: PbEmaSparkBar[];
  sparkByTf: Record<string, PbEmaSparkBar[]>;
  detailByTf: Record<string, Partial<TrendBandHit>>;
  companyName: string;
};

function mapDbRow(r: DbRow, names: Map<string, string>): TrendBandApiRow {
  const tf = r.timeframe || "1d";
  return {
    symbol: r.symbol,
    barDate: r.bar_date,
    timeframes: [tf],
    assetClass: r.asset_class ?? "equity",
    setupKind: r.setup_kind,
    score: r.score,
    close: r.close,
    bandLo: r.band_lo ?? r.ema200_low,
    bandHi: r.band_hi ?? r.ema200_high,
    ema200High: r.ema200_high ?? r.band_hi,
    ema200Low: r.ema200_low ?? r.band_lo,
    invalidation: r.invalidation ?? r.ema200_low,
    distToBandPct: r.dist_to_band_pct,
    pullbackPct: r.pullback_pct,
    advancePct: r.advance_pct,
    bandSlopePct: r.band_slope_pct,
    bandColor: r.band_color,
    bandFlip: Boolean(r.band_flip),
    daysSinceFlip: r.days_since_flip,
    dualTimeframe: Boolean(r.dual_timeframe),
    spark: (r.spark as PbEmaSparkBar[]) ?? [],
    sparkByTf: { [tf]: (r.spark as PbEmaSparkBar[]) ?? [] },
    detailByTf: {},
    companyName: names.get(r.symbol) ?? r.symbol,
  };
}

function mergeRows(rows: TrendBandApiRow[]): TrendBandApiRow[] {
  const by = new Map<string, TrendBandApiRow>();
  for (const r of rows) {
    const ex = by.get(r.symbol);
    if (!ex) {
      by.set(r.symbol, { ...r });
      continue;
    }
    const tfs = Array.from(new Set([...ex.timeframes, ...r.timeframes]));
    const dual = tfs.length >= 2;
    const score = Math.max(ex.score ?? 0, r.score ?? 0) + (dual ? PB_EMA_DEFAULTS.dualTimeframeBonus : 0);
    by.set(r.symbol, {
      ...ex,
      timeframes: tfs,
      score,
      dualTimeframe: dual,
      spark: r.spark.length > ex.spark.length ? r.spark : ex.spark,
      sparkByTf: { ...ex.sparkByTf, ...r.sparkByTf },
      bandFlip: ex.bandFlip || r.bandFlip,
      setupKind: ex.bandFlip || r.bandFlip ? "band_flip" : ex.setupKind,
    });
  }
  return Array.from(by.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function classifyAsset(sym: string): string {
  if (sym.startsWith("^")) return "index";
  if (sym.endsWith("-USD")) return "crypto";
  if (["USO", "XLE", "XLV", "XLF", "DBC", "GLD", "SPY", "QQQ", "IWM"].includes(sym)) return "etf";
  return "equity";
}

async function liveScanSample(symbols: string[], limit: number): Promise<TrendBandApiRow[]> {
  const flat: TrendBandApiRow[] = [];
  for (const sym of symbols.slice(0, limit)) {
    const bars = await fetchYahooDaily(sym, "10y");
    if (bars.length < PB_EMA_DEFAULTS.historyMinBars) continue;
    const candles = bars.map((b) => ({
      time: String(b.date).slice(0, 10),
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    for (const hit of scanBothTimeframes(candles)) {
      flat.push({
        symbol: sym,
        barDate: hit.spark[hit.spark.length - 1]?.date ?? String(bars[bars.length - 1]?.date).slice(0, 10),
        timeframes: [hit.timeframe],
        assetClass: classifyAsset(sym),
        setupKind: hit.setupKind,
        score: hit.score,
        close: hit.close,
        bandLo: hit.bandLo,
        bandHi: hit.bandHi,
        ema200High: hit.ema200High,
        ema200Low: hit.ema200Low,
        invalidation: hit.invalidation,
        distToBandPct: hit.distToBandPct,
        pullbackPct: hit.pullbackPct,
        advancePct: hit.advancePct,
        bandSlopePct: hit.bandSlopePct,
        bandColor: hit.bandColor,
        bandFlip: hit.bandFlip,
        daysSinceFlip: hit.daysSinceFlip,
        dualTimeframe: false,
        spark: hit.spark,
        sparkByTf: { [hit.timeframe]: hit.spark },
        detailByTf: {},
        companyName: sym,
      });
    }
  }
  return mergeRows(flat);
}

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const flipOnly = req.nextUrl.searchParams.get("flip") === "1";
  const tfFilter = req.nextUrl.searchParams.get("timeframe");
  const assetFilter = req.nextUrl.searchParams.get("asset");

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
      if (run?.asof_date) {
        rows = await fetchAll<DbRow>(
          sb,
          "trend_band_setups",
          "symbol, bar_date, timeframe, asset_class, setup_kind, score, close, band_lo, band_hi, ema200_high, ema200_low, invalidation, dist_to_band_pct, pullback_pct, advance_pct, band_slope_pct, band_color, band_flip, days_since_flip, dual_timeframe, spark",
          (q) => q.eq("bar_date", run!.asof_date)
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
    let mapped = mergeRows(rows.map((r) => mapDbRow(r, names)));

    if (!mapped.length) {
      dataSource = "live_yahoo";
      const syms = Array.from(
        new Set([
          ...uni.map((u) => u.symbol),
          "USO",
          "XLE",
          "XLV",
          "AZN",
          "SPY",
          "QQQ",
          "BTC-USD",
          "ETH-USD",
          "^GSPC",
        ])
      );
      mapped = await liveScanSample(syms, 40);
    }

    if (kind && kind !== "all") mapped = mapped.filter((r) => r.setupKind === kind);
    if (flipOnly) mapped = mapped.filter((r) => r.bandFlip);
    if (tfFilter && tfFilter !== "all") {
      mapped = mapped.filter((r) => r.timeframes.includes(tfFilter));
    }
    if (assetFilter && assetFilter !== "all") {
      mapped = mapped.filter((r) => r.assetClass === assetFilter);
    }

    return NextResponse.json({
      asOfDate: run?.asof_date ?? mapped[0]?.barDate ?? null,
      headline: run?.headline ?? (mapped.length ? `${mapped.length} live pb_ema hits (sample)` : null),
      names: mapped.length,
      rows: mapped,
      dataSource,
      disclaimer: DISCLAIMER,
      band: {
        emaPeriod: 200,
        upper: "EMA200(high)",
        lower: "EMA200(low)",
        note: "Extends ema200_scanner math; weekly resampled from daily with ≥220 week warmup.",
      },
    });
  } catch (err) {
    console.error("[trend-band]", err);
    return NextResponse.json({ rows: [], disclaimer: DISCLAIMER, error: "fetch_failed" }, { status: 500 });
  }
}