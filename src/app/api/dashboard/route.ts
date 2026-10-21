import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { fetchLitePrices, LIQUID_NAMES } from "@/lib/liteDeskApi";
import { orbisScore } from "@/lib/orbisScore";
import { fetchCockpitDeskSummaries } from "@/lib/cockpitDeskSummaries";
import { combineCapital, legsFromBooks } from "@/lib/capitalBook";
import { evaluateFreshness } from "@/lib/freshness";

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

function crossAssetTiles(
  prices: { symbol: string; date: string; close: number }[]
): { symbol: string; label: string; last: number | null; dayPct: number | null; spark: number[] }[] {
  const bySym = new Map<string, { date: string; close: number }[]>();
  for (const p of prices) {
    const list = bySym.get(p.symbol) ?? [];
    list.push({ date: p.date, close: p.close });
    bySym.set(p.symbol, list);
  }
  return CROSS_ASSET_META.map(({ symbol, label }) => {
    const series = (bySym.get(symbol) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    if (series.length < 2) {
      return { symbol, label, last: series.at(-1)?.close ?? null, dayPct: null, spark: series.map((s) => s.close) };
    }
    const prev = series[series.length - 2].close;
    const last = series[series.length - 1].close;
    const dayPct = prev > 0 ? ((last / prev - 1) * 100) : null;
    return {
      symbol,
      label,
      last,
      dayPct,
      spark: series.slice(-20).map((s) => s.close),
    };
  }).filter((t) => t.spark.length > 0);
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

    const [crossPrices, desks, capital] = await Promise.all([
      fetchLitePrices(sb, [
        ...CROSS_ASSET_META.map((c) => c.symbol),
        ...LIQUID_NAMES.slice(0, 4),
      ]),
      fetchCockpitDeskSummaries(sb),
      fetchCapitalBook(sb),
    ]);

    const fresh = evaluateFreshness(brief?.asof_date);

    return NextResponse.json({
      asOfDate: brief?.asof_date ?? null,
      briefText: brief?.brief ?? null,
      stale: fresh.stale,
      signalsSuppressed: fresh.signalsSuppressed,
      capital,
      posture: inputs.posture_score ?? null,
      postureLabel: inputs.posture_label ?? null,
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
      bestSector: breadthRaw?.best_sector ?? null,
      worstSector: breadthRaw?.worst_sector ?? null,
      regionBreadth: inputs.region_breadth ?? {},
      crossAsset: crossAssetTiles(crossPrices),
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
    });
  } catch (err) {
    console.error("Dashboard API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
