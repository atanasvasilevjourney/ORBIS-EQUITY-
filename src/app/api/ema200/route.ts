import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { isMissingRelation } from "@/lib/supabase/errors";
import {
  daysSinceRibbonTouch,
  isApproachingPullback,
  ribbonDistAtr,
  ribbonDistPct,
  ribbonDistUsd,
} from "@/lib/ema200Distance";
import {
  EMA200_DEFAULTS,
  classifyEma200Setup,
  tradingViewUrl,
  type Ema200FeatureRow,
} from "@/lib/ema200Watchlist";

export const revalidate = 900;

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
  regime: string | null;
};

type UniverseRow = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  country: string | null;
};

type FundRow = {
  symbol: string;
  price: number | null;
  market_cap: number | null;
  average_volume: number | null;
};

function groupHistoryBySymbol(rows: FeatureDbRow[]): Map<string, FeatureDbRow[]> {
  const m = new Map<string, FeatureDbRow[]>();
  for (const r of rows) {
    const list = m.get(r.symbol) ?? [];
    list.push(r);
    m.set(r.symbol, list);
  }
  return m;
}

function priorBar(history: FeatureDbRow[], asOfDate: string): FeatureDbRow | null {
  const sorted = [...history].sort((a, b) => a.bar_date.localeCompare(b.bar_date));
  const idx = sorted.findIndex((b) => b.bar_date === asOfDate);
  if (idx <= 0) return null;
  return sorted[idx - 1];
}

function mapRow(
  r: FeatureDbRow,
  opts: Partial<typeof EMA200_DEFAULTS>,
  ctx: {
    asOfDate: string;
    history: FeatureDbRow[];
    uMap: Map<string, UniverseRow>;
    fMap: Map<string, FundRow>;
    indexMap: Map<string, string | null>;
    retraceOnly: boolean;
  }
) {
  const feat: Ema200FeatureRow = {
    symbol: r.symbol,
    bar_date: r.bar_date,
    close: r.close,
    ema200: r.ema200,
    ema200_high: r.ema200_high,
    dist_atr: r.dist_atr,
    ribbon_dist_atr: r.ribbon_dist_atr,
    days_above: r.days_above,
    ema200_slope: r.ema200_slope,
    rvol: r.rvol,
    regime: r.regime,
  };
  const setup = classifyEma200Setup(feat, opts);
  const onWatch = setup != null && (!ctx.retraceOnly || setup === "RETRACE_HELD");
  const approaching = isApproachingPullback(feat, setup);
  if (!onWatch && !approaching) return null;

  const prev = priorBar(ctx.history, ctx.asOfDate);
  const prevFeat: Ema200FeatureRow | null = prev
    ? {
        symbol: prev.symbol,
        close: prev.close,
        ema200: prev.ema200,
        ema200_high: prev.ema200_high,
        dist_atr: prev.dist_atr,
        ribbon_dist_atr: prev.ribbon_dist_atr,
        days_above: prev.days_above,
        ema200_slope: prev.ema200_slope,
      }
    : null;
  const distAtr = ribbonDistAtr(feat);
  const prevDistAtr = prevFeat ? ribbonDistAtr(prevFeat) : null;
  const distDeltaAtr =
    distAtr != null && prevDistAtr != null ? distAtr - prevDistAtr : null;

  const u = ctx.uMap.get(r.symbol);
  const f = ctx.fMap.get(r.symbol);
  const tag = ctx.indexMap.get(r.symbol);

  return {
    symbol: r.symbol,
    companyName: u?.company_name ?? "",
    sector: u?.sector ?? "",
    country: u?.country ?? "US",
    indexTag: tag ?? null,
    barDate: r.bar_date,
    lane: onWatch ? "watch" : "approaching",
    setup: setup ?? "APPROACHING",
    close: r.close,
    ema200: r.ema200,
    ema200High: r.ema200_high,
    distAtr,
    ribbonDistAtr: r.ribbon_dist_atr,
    closeDistAtr: r.dist_atr,
    distUsd: ribbonDistUsd(r.close, r.ema200, r.ema200_high),
    distPct: ribbonDistPct(r.close, r.ema200, r.ema200_high),
    distDeltaAtr,
    prevDistAtr,
    daysSinceRibbonTouch: daysSinceRibbonTouch(
      ctx.history.map((h) => ({
        bar_date: h.bar_date,
        ribbon_dist_atr: h.ribbon_dist_atr,
        dist_atr: h.dist_atr,
      })),
      ctx.asOfDate
    ),
    daysAbove: r.days_above,
    ema200Slope: r.ema200_slope,
    rvol: r.rvol,
    regime: r.regime,
    marketCap: f?.market_cap ?? null,
    price: f?.price ?? r.close,
    tradingViewUrl: tradingViewUrl(r.symbol),
  };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(parseInt(sp.get("limit") ?? "500", 10), 500);
    const showAllNear = sp.get("near") === "1";
    const retraceOnly = sp.get("near") !== "1";

    const sb = createServerClient();

    let features: FeatureDbRow[] = [];
    try {
      features = await fetchAll<FeatureDbRow>(
        sb,
        "ema200_features",
        "symbol, bar_date, close, ema200, ema200_high, dist_atr, ribbon_dist_atr, days_above, ema200_slope, rvol, regime"
      );
    } catch (err) {
      if (!isMissingRelation(err)) throw err;
    }

    if (!features.length) {
      return NextResponse.json({
        mode: "watchlist_only",
        asOfDate: null,
        disclaimer:
          "Discretionary scan only — not a trade signal. Run migration 021 and pipeline.ema200_scanner.jobs.nightly to populate features.",
        rows: [],
      });
    }

    const latestDate = features.reduce(
      (max, r) => (r.bar_date > max ? r.bar_date : max),
      features[0].bar_date
    );
    type ScannerUniverseRow = { symbol: string; index_tag: string | null; asset_class: string | null };
    let scannerUniverse: ScannerUniverseRow[] = [];
    try {
      scannerUniverse = await fetchAll<ScannerUniverseRow>(
        sb,
        "ema200_universe",
        "symbol, index_tag, asset_class",
        (q) => q.eq("active", true).eq("asset_class", "equity")
      );
    } catch (err) {
      if (!isMissingRelation(err)) throw err;
    }
    const allowedSymbols = new Set(scannerUniverse.map((u) => u.symbol));
    const indexMap = new Map(scannerUniverse.map((u) => [u.symbol, u.index_tag]));

    const latestRows = features.filter(
      (r) => r.bar_date === latestDate && (allowedSymbols.size === 0 || allowedSymbols.has(r.symbol))
    );

    const opts = showAllNear
      ? { ...EMA200_DEFAULTS, requireUptrend: false, requireCloseAboveEma: false }
      : EMA200_DEFAULTS;

    const [universe, fundamentals] = await Promise.all([
      fetchAll<UniverseRow>(
        sb,
        "universe_members",
        "symbol, company_name, sector, country",
        (q) => q.eq("is_active", true)
      ),
      fetchAll<FundRow>(
        sb,
        "fundamentals_snapshot",
        "symbol, price, market_cap, average_volume"
      ),
    ]);
    const uMap = new Map(universe.map((u) => [u.symbol, u]));
    const fMap = new Map(fundamentals.map((f) => [f.symbol, f]));

    const historyBySymbol = groupHistoryBySymbol(features);
    const ctxBase = { asOfDate: latestDate, uMap, fMap, indexMap, retraceOnly };

    const mapped = latestRows
      .map((r) =>
        mapRow(r, opts, {
          ...ctxBase,
          history: historyBySymbol.get(r.symbol) ?? [r],
        })
      )
      .filter(Boolean) as NonNullable<ReturnType<typeof mapRow>>[];

    const watch = mapped
      .filter((r) => r.lane === "watch")
      .sort((a, b) => (a.distAtr ?? 99) - (b.distAtr ?? 99))
      .slice(0, limit);
    const approaching = mapped
      .filter((r) => r.lane === "approaching")
      .sort((a, b) => (a.distAtr ?? 99) - (b.distAtr ?? 99))
      .slice(0, limit);

    const rowsOnlyWatch = sp.get("approaching") !== "1";

    return NextResponse.json({
      mode: "watchlist_only",
      asOfDate: latestDate,
      universe: "sp500_ndx100",
      universeCount: allowedSymbols.size || null,
      shortlistAtr: EMA200_DEFAULTS.shortlistAtr,
      approachingMaxAtr: 3,
      disclaimer:
        "S&P 500 + Nasdaq-100 only. WATCH = at the ribbon (≤1.5 ATR). APPROACHING = still extended but closing in (1.5–3 ATR) with uptrend intact. Dist Δ = change vs prior session (negative = closer). Days since touch = sessions since last ≤1.5 ATR ribbon tag.",
      filter: showAllNear ? "near_ema_relaxed" : "retrace_held_only",
      rows: rowsOnlyWatch ? watch : approaching,
      watch,
      approaching,
    });
  } catch (err) {
    console.error("EMA200 watchlist API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
