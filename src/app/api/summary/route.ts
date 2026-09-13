import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { lastClosedSession, sessionLabel, sessionState } from "@/lib/cashSession";
import { sectorBreadth } from "@/lib/sectorBreadth";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sb = createServerClient();

    const { data: brief } = await sb
      .from("daily_brief")
      .select("asof_date, brief, inputs")
      .order("asof_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const [radar, universe] = await Promise.all([
      fetchAll<{ symbol: string; state: number; quality_rank: number }>(
        sb,
        "trend_radar",
        "symbol, state, quality_rank"
      ),
      fetchAll<{ symbol: string; sector: string | null }>(
        sb,
        "universe_members",
        "symbol, sector",
        (q) => q.eq("is_active", true)
      ),
    ]);

    const total = radar.length;
    const greens = radar.filter((r) => r.state === 1).length;
    const reds = radar.filter((r) => r.state === -1).length;
    const avgRank = total > 0
      ? Math.round(radar.reduce((s, r) => s + r.quality_rank, 0) / total)
      : 0;

    const inputs = (brief?.inputs && typeof brief.inputs === "object")
      ? brief.inputs as Record<string, unknown>
      : {};

    let stale = false;
    if (brief?.asof_date) {
      const asOf = new Date(brief.asof_date);
      const diffDays = (Date.now() - asOf.getTime()) / (1000 * 60 * 60 * 24);
      stale = diffDays > 3;
    }

    const stored = inputs.breadth as Record<string, unknown> | undefined;
    const sectors = sectorBreadth(radar, universe);
    const liveBest = sectors[0] ?? null;
    const liveWorst = sectors.length ? sectors[sectors.length - 1] : null;

    const { data: lastBar } = await sb
      .from("prices_daily")
      .select("date, source")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const tapeDate = (lastBar?.date as string | undefined) ?? null;
    let tapeNames = 0;
    if (tapeDate) {
      const { count } = await sb
        .from("prices_daily")
        .select("symbol", { count: "exact", head: true })
        .eq("date", tapeDate);
      tapeNames = count ?? 0;
    }

    const sess = sessionState();
    const closed = lastClosedSession();

    return NextResponse.json({
      asOfDate: tapeDate ?? brief?.asof_date ?? null,
      briefText: brief?.brief ?? null,
      posture: inputs.posture_score ?? null,
      postureLabel: inputs.posture_label ?? null,
      breadth: {
        total,
        greens,
        reds,
        pctGreen: total > 0 ? Math.round((greens / total) * 100) : 0,
        pctRed: total > 0 ? Math.round((reds / total) * 100) : 0,
      },
      avgRank,
      bestSector: liveBest?.sector ?? (stored?.best_sector as string | undefined) ?? null,
      worstSector: liveWorst?.sector ?? (stored?.worst_sector as string | undefined) ?? null,
      bestSectorScore: liveBest?.net ?? null,
      worstSectorScore: liveWorst?.net ?? null,
      sectors,
      regionBreadth: inputs.region_breadth ?? {},
      stale: stale || (tapeDate != null && tapeDate < closed),
      tape: {
        source: (lastBar?.source as string | undefined) ?? null,
        lastClose: tapeDate,
        names: tapeNames,
      },
      session: {
        state: sess,
        label: sessionLabel(sess),
        lastClosedSession: closed,
        workday: sess !== "CLOSED_WEEKEND",
        lseStreaming: false,
        yahoo5mOnDemand: true,
      },
    });
  } catch (err) {
    console.error("Summary API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
