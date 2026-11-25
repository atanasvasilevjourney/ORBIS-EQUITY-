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
import { fetchSessionQuotes } from "@/lib/sessionQuotes";
import { countAdvancersDecliners } from "@/lib/liveBreadth";
import { buildBreadthBlock } from "@/lib/breadthLabels";

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
    const quotes = await fetchSessionQuotes(
      sb,
      radar.map((r) => r.symbol)
    );
    const { advancers, decliners } = countAdvancersDecliners(radar, quotes);
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
      postureBasis: "advancers_pct",
      postureDefinition:
        "Posture score (0–100) equals the percentage of active universe names with a positive latest session close-to-close return.",
      postureLabel: liveLabel,
      breadth: buildBreadthBlock({
        total,
        onList: greens,
        onListDown: reds,
        downDay: decliners,
        advancers,
      }),
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
