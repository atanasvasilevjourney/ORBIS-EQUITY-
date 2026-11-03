import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { fetchLitePrices } from "@/lib/liteDeskApi";
import {
  finiteOrNull,
  SCOREBOARD_SYMBOLS,
  scoreboardName,
  sessionMove,
} from "@/lib/rotationDesk";
import { orbisScore } from "@/lib/orbisScore";
import { fetchCockpitDeskSummaries, type CockpitDeskSummaries } from "@/lib/cockpitDeskSummaries";
import { combineCapital, legsFromBooks } from "@/lib/capitalBook";
import { evaluateFreshness, lastExpectedEodDate } from "@/lib/freshness";
import { fillMissingTape } from "@/lib/marketTapeFill";
import { composeMarketBrief } from "@/lib/marketBrief";
import { deskNewsFromRows, loadMarketHeadlines, newsSource, type BriefNewsItem } from "@/lib/briefNews";

export const revalidate = 900;

const CROSS_ASSET_META: { symbol: string; label: string }[] = [
  { symbol: "SPY", label: "S&P 500" },
  { symbol: "QQQ", label: "Nasdaq 100" },
  { symbol: "IWM", label: "Russell 2K" },
  { symbol: "DIA", label: "Dow" },
  { symbol: "GLD", label: "Gold" },
  { symbol: "TLT", label: "Long bond" },
];

function latestAsOf(rows: { asof_date?: string | null }[]): string | null {
  const dates = rows
    .map((row) => row.asof_date)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();
  return dates.at(-1) ?? null;
}

async function fetchCapitalBook(sb: ReturnType<typeof createServerClient>) {
  const [loop, loopRuns, orb, orbRuns, cash, cashRuns, rotate, rotateRuns] = await Promise.all([
    fetchAll<{ symbol: string; side: string | null; shares: number | null; last: number | null }>(
      sb,
      "paper_book",
      "symbol, side, shares, last"
    ),
    fetchAll<{ asof_date: string | null }>(sb, "paper_loop_runs", "asof_date"),
    fetchAll<{
      symbol: string;
      status: string | null;
      shares: number | null;
      last_px: number | null;
      entry: number | null;
    }>(sb, "orb_watch", "symbol, status, shares, last_px, entry"),
    fetchAll<{ asof_date: string | null }>(sb, "orb_runs", "asof_date"),
    fetchAll<{
      symbol: string;
      in_tema_book: boolean | null;
      tema_side: string | null;
      tema_notional: number | null;
      in_carver_book: boolean | null;
      carver_side: string | null;
      carver_notional: number | null;
    }>(
      sb,
      "perp_names",
      "symbol, in_tema_book, tema_side, tema_notional, in_carver_book, carver_side, carver_notional"
    ),
    fetchAll<{ asof_date: string | null }>(sb, "perp_runs", "asof_date"),
    fetchAll<{ symbol: string; side: string | null; notional: number | null }>(
      sb,
      "sector_rotation_carver",
      "symbol, side, notional"
    ),
    fetchAll<{ asof_date: string | null }>(sb, "sector_rotation_runs", "asof_date"),
  ]);

  return combineCapital(
    legsFromBooks({
      loopAsOf: latestAsOf(loopRuns),
      loop,
      orbAsOf: latestAsOf(orbRuns),
      orb: orb.map((row) => ({
        symbol: row.symbol,
        status: row.status,
        shares: row.shares,
        last: row.last_px,
        entry: row.entry,
      })),
      cashAsOf: latestAsOf(cashRuns),
      cash: cash.map((row) => ({
        symbol: row.symbol,
        inTema: !!row.in_tema_book,
        temaSide: row.tema_side,
        temaNotional: row.tema_notional,
        inCarver: !!row.in_carver_book,
        carverSide: row.carver_side,
        carverNotional: row.carver_notional,
      })),
      rotateAsOf: latestAsOf(rotateRuns),
      rotate,
    })
  );
}

function seriesBySymbol(prices: { symbol: string; date: string; close: number }[]) {
  const bySym = new Map<string, { date: string; close: number }[]>();
  for (const p of prices) {
    const list = bySym.get(p.symbol) ?? [];
    list.push({ date: p.date, close: p.close });
    bySym.set(p.symbol, list);
  }
  return bySym;
}

function crossAssetTiles(
  prices: { symbol: string; date: string; close: number }[],
  filled: Set<string>
): {
  symbol: string;
  label: string;
  last: number | null;
  dayPct: number | null;
  asOf: string | null;
  spark: number[];
  source: "tape" | "yahoo";
}[] {
  const bySym = seriesBySymbol(prices);
  return CROSS_ASSET_META.map(({ symbol, label }) => {
    const series = [...(bySym.get(symbol) ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const move = sessionMove(series);
    return {
      symbol,
      label,
      last: move.last,
      dayPct: move.dayPct,
      asOf: move.asOf,
      spark: series.slice(-20).map((s) => s.close),
      source: filled.has(symbol) ? ("yahoo" as const) : ("tape" as const),
    };
  }).filter((t) => t.spark.length > 0);
}

function emptyDesks(): CockpitDeskSummaries {
  return {
    earningsBeats: 0,
    earningsMisses: 0,
    earningsUpcoming: 0,
    newsCount: 0,
    skewNames: 0,
    skewAtm: null,
    skewWeekend: null,
    orbGappers: 0,
    orbBreakouts: 0,
    analysisBuys: 0,
    analysisSells: 0,
    quantNames: 0,
    quantSharpe: null,
    biasLongs: 0,
    biasShorts: 0,
    cashTema: 0,
    cashCarver: 0,
    triangleSetups: 0,
    triangleBreakouts: 0,
  };
}

function intelligenceBlock(
  headlines: BriefNewsItem[],
  composed: ReturnType<typeof composeMarketBrief>,
  filled: string[]
) {
  return {
    news: headlines,
    newsSource: newsSource(headlines),
    marketBrief: composed.text,
    briefSource: composed.source,
    tapeFilled: filled,
  };
}

async function liveCockpit() {
  const tapeSymbols = [...CROSS_ASSET_META.map((row) => row.symbol), ...SCOREBOARD_SYMBOLS];
  const { prices, filled } = await fillMissingTape([], tapeSymbols);
  const headlines = await loadMarketHeadlines([]);
  const crossAsset = crossAssetTiles(prices, new Set(filled));
  const composed = composeMarketBrief({
    pipelineBrief: null,
    postureLabel: null,
    advancersPct: null,
    bestSector: null,
    worstSector: null,
    regime: null,
    quotes: crossAsset,
  });
  const asOfDate = crossAsset
    .map((tile) => tile.asOf)
    .filter((date): date is string => !!date)
    .sort()
    .at(-1) ?? null;
  return {
    degraded: true,
    asOfDate,
    briefText: composed.text || null,
    stale: true,
    signalsSuppressed: true,
    capital: null,
    posture: null,
    postureLabel: null,
    posturePillars: null,
    breadth: null,
    avgRank: 0,
    bestSector: null,
    worstSector: null,
    regionBreadth: {},
    crossAsset,
    scoreboard: scoreboardTiles(prices, new Map(), new Map(), new Set(filled)),
    rotation: { regime: null, headline: null, sectors: [], leading: 0 },
    watchlistMovers: [],
    fundamentals: { count: 0, highComposite: 0, highFScore: 0, avgComposite: 0 },
    desks: emptyDesks(),
    intelligence: intelligenceBlock(headlines, composed, filled),
  };
}

function scoreboardTiles(
  prices: { symbol: string; date: string; close: number }[],
  names: Map<string, string | null>,
  yields: Map<string, { fcf: number | null; earnings: number | null }>,
  filled: Set<string>
) {
  const bySym = seriesBySymbol(prices);
  return SCOREBOARD_SYMBOLS.map((symbol) => {
    const move = sessionMove(bySym.get(symbol) ?? []);
    const fund = yields.get(symbol);
    return {
      symbol,
      name: scoreboardName(symbol, names.get(symbol)),
      last: move.last,
      dayPct: move.dayPct,
      fcfYield: fund?.fcf ?? null,
      earningsYield: fund?.earnings ?? null,
      asOf: move.asOf,
      source: filled.has(symbol) ? ("yahoo" as const) : ("tape" as const),
    };
  });
}

export async function GET() {
  try {
    const sb = createServerClient();

    const { data: brief } = await sb
      .from("daily_brief")
      .select("asof_date, brief, inputs")
      .order("asof_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const radar = await fetchAll<{ state: number; quality_rank: number; z_mom: number | null; symbol: string }>(
      sb,
      "trend_radar",
      "symbol, state, quality_rank, z_mom"
    );

    const total = radar.length;
    const greens = radar.filter((r) => r.state === 1).length;
    const reds = radar.filter((r) => r.state === -1).length;
    const advancers = radar.filter((r) => (r.z_mom ?? 0) > 0).length;

    const inputs = (brief?.inputs && typeof brief.inputs === "object")
      ? (brief.inputs as Record<string, unknown>)
      : {};

    const breadthRaw = inputs.breadth as Record<string, unknown> | undefined;
    const posturePillars = inputs.posture_pillars as Record<string, unknown> | undefined;

    const fundRows = await fetchAll<{ composite_factor_score: number | null; f_score: number | null }>(
      sb,
      "fundamentals_snapshot",
      "composite_factor_score, f_score"
    );

    const composites = fundRows.filter((r) => r.composite_factor_score != null);
    const avgComposite =
      composites.length > 0
        ? Math.round(
            composites.reduce((s, r) => s + (r.composite_factor_score ?? 0), 0) / composites.length
          )
        : 0;

    const runs = await fetchAll<{ run_id: string; regime: string | null; headline: string | null; computed_at: string | null }>(
      sb,
      "sector_rotation_runs",
      "run_id, regime, headline, computed_at",
      (q) => q.order("computed_at", { ascending: false })
    );
    const latestRun = runs[0] ?? null;
    let rotationSectors: {
      name: string;
      rs4w: number | null;
      impulse: number | null;
      label: string | null;
      nNames: number;
      score: number | null;
    }[] = [];
    if (latestRun) {
      const groups = await fetchAll<{
        group_type: string;
        name: string;
        n_names: number | null;
        rs_4w: number | null;
        impulse: number | null;
        label: string | null;
        score: number | null;
        run_id: string | null;
      }>(sb, "sector_rotation_groups", "group_type, name, n_names, rs_4w, impulse, label, score, run_id");
      rotationSectors = groups
        .filter((g) => g.run_id === latestRun.run_id && g.group_type === "sector")
        .map((g) => ({
          name: g.name,
          rs4w: g.rs_4w,
          impulse: g.impulse,
          label: g.label,
          nNames: g.n_names ?? 0,
          score: g.score,
        }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 12);
    }

    const watchlistMovers = radar
      .filter((r) => r.state === 1)
      .sort((a, b) => b.quality_rank - a.quality_rank)
      .slice(0, 8)
      .map((r) => ({
        symbol: r.symbol,
        rank: r.quality_rank,
        dayPct: r.z_mom,
        orbisScore: orbisScore(r.quality_rank, null),
      }));

    const tapeSymbols = [...CROSS_ASSET_META.map((c) => c.symbol), ...SCOREBOARD_SYMBOLS];
    const [rawPrices, desks, capital, scoreNames, scoreFunds, newsRes] = await Promise.all([
      fetchLitePrices(sb, tapeSymbols),
      fetchCockpitDeskSummaries(sb),
      fetchCapitalBook(sb),
      fetchAll<{ symbol: string; company_name: string | null }>(
        sb,
        "universe_members",
        "symbol, company_name",
        (q) => q.in("symbol", [...SCOREBOARD_SYMBOLS])
      ).catch(() => []),
      fetchAll<{ symbol: string; fcf_yield: number | null; earnings_yield: number | null }>(
        sb,
        "fundamentals_snapshot",
        "symbol, fcf_yield, earnings_yield",
        (q) => q.in("symbol", [...SCOREBOARD_SYMBOLS])
      ).catch(() => []),
      sb
        .from("news_items")
        .select("id, ticker, published_at, source, headline, url, tone")
        .order("published_at", { ascending: false })
        .limit(8),
    ]);
    const { prices: crossPrices, filled } = await fillMissingTape(
      rawPrices,
      tapeSymbols,
      undefined,
      lastExpectedEodDate()
    );
    const crossAsset = crossAssetTiles(crossPrices, new Set(filled));
    const headlines = await loadMarketHeadlines(
      deskNewsFromRows(Array.isArray(newsRes.data) ? newsRes.data : [])
    );
    const postureLabel = typeof inputs.posture_label === "string" ? inputs.posture_label : null;
    const bestSector = typeof breadthRaw?.best_sector === "string" ? breadthRaw.best_sector : null;
    const worstSector = typeof breadthRaw?.worst_sector === "string" ? breadthRaw.worst_sector : null;
    const advancersPct = total > 0 ? Math.round((advancers / total) * 100) : null;
    const composed = composeMarketBrief({
      pipelineBrief: brief?.brief ?? null,
      postureLabel,
      advancersPct,
      bestSector,
      worstSector,
      regime: latestRun?.regime ?? null,
      quotes: crossAsset,
    });

    const fresh = evaluateFreshness(brief?.asof_date);

    return NextResponse.json({
      degraded: false,
      asOfDate: brief?.asof_date ?? null,
      briefText: composed.text || brief?.brief || null,
      stale: fresh.stale,
      signalsSuppressed: fresh.signalsSuppressed,
      capital,
      posture: inputs.posture_score ?? null,
      postureLabel,
      posturePillars: posturePillars ?? null,
      breadth: {
        total,
        onList: greens,
        onListPct: total > 0 ? Math.round((greens / total) * 100) : 0,
        downDay: reds,
        downDayPct: total > 0 ? Math.round((reds / total) * 100) : 0,
        advancersPct: total > 0 ? Math.round((advancers / total) * 100) : 0,
        greens,
        reds,
        pctGreen: total > 0 ? Math.round((greens / total) * 100) : 0,
        pctRed: total > 0 ? Math.round((reds / total) * 100) : 0,
      },
      avgRank: total > 0 ? Math.round(radar.reduce((s, r) => s + r.quality_rank, 0) / total) : 0,
      bestSector,
      worstSector,
      regionBreadth: inputs.region_breadth ?? {},
      crossAsset,
      scoreboard: scoreboardTiles(
        crossPrices,
        new Map(scoreNames.map((row) => [row.symbol, row.company_name])),
        new Map(
          scoreFunds.map((row) => [
            row.symbol,
            { fcf: finiteOrNull(row.fcf_yield), earnings: finiteOrNull(row.earnings_yield) },
          ])
        ),
        new Set(filled)
      ),
      rotation: {
        regime: latestRun?.regime ?? null,
        headline: latestRun?.headline ?? null,
        sectors: rotationSectors,
        leading: rotationSectors.filter((s) => s.label === "LEAD").length,
      },
      watchlistMovers,
      fundamentals: {
        count: fundRows.length,
        highComposite: composites.filter((r) => (r.composite_factor_score ?? 0) >= 70).length,
        highFScore: fundRows.filter((r) => (r.f_score ?? 0) >= 7).length,
        avgComposite,
      },
      desks,
      intelligence: intelligenceBlock(headlines, composed, filled),
    });
  } catch (err) {
    console.error("Dashboard API error:", err);
    try {
      return NextResponse.json(await liveCockpit());
    } catch (liveErr) {
      console.error("Dashboard live tape error:", liveErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }
}
