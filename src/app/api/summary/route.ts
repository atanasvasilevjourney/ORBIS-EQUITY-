import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { evaluateFreshness } from "@/lib/freshness";
import {
  computePostureLabel,
  computePosturePillars,
  computePostureScore,
  isPostureBriefStale,
  sectorLeaders,
} from "@/lib/postureDesk";

export const revalidate = 900;

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

    const universe = await fetchAll<{ symbol: string; sector: string | null }>(
      sb,
      "universe_members",
      "symbol, sector",
      (q) => q.eq("is_active", true)
    );

    const total = radar.length;
    const greens = radar.filter((r) => r.state === 1).length;
    const reds = radar.filter((r) => r.state === -1).length;
    const decliners = radar.filter((r) => (r.z_mom ?? 0) < 0).length;
    const advancers = radar.filter((r) => (r.z_mom ?? 0) > 0).length;
    const avgRank = total > 0
      ? Math.round(radar.reduce((s, r) => s + r.quality_rank, 0) / total)
      : 0;

    const inputs = (brief?.inputs && typeof brief.inputs === "object")
      ? brief.inputs as Record<string, unknown>
      : {};

    const { data: pxRow } = await sb
      .from("prices_daily")
      .select("date")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const pricesAsOf = pxRow?.date?.slice?.(0, 10) ?? null;
    const freshVerdict = evaluateFreshness(pricesAsOf ?? brief?.asof_date ?? null, pricesAsOf);
    const stale = freshVerdict.stale;

    const breadth = inputs.breadth as Record<string, unknown> | undefined;
    const briefAsOf = brief?.asof_date?.slice?.(0, 10) ?? null;
    const postureBriefStale = isPostureBriefStale(briefAsOf, pricesAsOf);
    const onListPct = total > 0 ? Math.round((greens / total) * 100) : 0;
    const liveAdvancers = total > 0 ? Math.round((advancers / total) * 100) : null;
    const livePosture = liveAdvancers != null ? computePostureScore(liveAdvancers) : null;
    const liveLabel = livePosture != null ? computePostureLabel(livePosture) : null;
    const liveSectors = sectorLeaders(radar, universe);
    const pillarsStored = inputs.posture_pillars as Record<string, unknown> | undefined;
    const livePillars =
      liveAdvancers != null
        ? computePosturePillars(liveAdvancers, radar, avgRank, onListPct)
        : null;

    return NextResponse.json({
      asOfDate: pricesAsOf ?? briefAsOf,
      pricesAsOf,
      postureAsOf: pricesAsOf ?? briefAsOf,
      postureBriefAsOf: briefAsOf,
      postureBriefStale,
      briefText: postureBriefStale ? null : brief?.brief ?? null,
      posture: livePosture,
      postureLabel: liveLabel,
      breadth: {
        total,
        /** Names on the module-1 watchlist (day ≥ +4%, vol ≥ 2× avg). */
        onList: greens,
        onListPct: total > 0 ? Math.round((greens / total) * 100) : 0,
        /** Names with a down day (close below prior close). */
        downDay: decliners,
        downDayPct: total > 0 ? Math.round((decliners / total) * 100) : 0,
        onListDown: reds,
        onListDownPct: total > 0 ? Math.round((reds / total) * 100) : 0,
        /** Share of universe up on the day — matches pipeline posture. */
        advancersPct: total > 0 ? Math.round((advancers / total) * 100) : 0,
        /** @deprecated Use onListPct — old label implied market breadth. */
        greens,
        reds,
        pctGreen: total > 0 ? Math.round((greens / total) * 100) : 0,
        pctRed: total > 0 ? Math.round((reds / total) * 100) : 0,
      },
      avgRank,
      bestSector:
        postureBriefStale || !breadth?.best_sector
          ? liveSectors.bestSector
          : (breadth.best_sector as string),
      worstSector:
        postureBriefStale || !breadth?.worst_sector
          ? liveSectors.worstSector
          : (breadth.worst_sector as string),
      regionBreadth: inputs.region_breadth ?? {},
      posturePillars: postureBriefStale || !pillarsStored ? livePillars : pillarsStored,
      stale,
      signalsSuppressed: freshVerdict.signalsSuppressed,
      expectedEodDate: freshVerdict.expectedEodDate,
    });
  } catch (err) {
    console.error("Summary API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
