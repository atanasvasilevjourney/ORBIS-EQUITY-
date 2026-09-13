import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { lastClosedSession, sessionLabel, sessionState } from "@/lib/cashSession";
import { liveTape } from "@/lib/sectorBreadth";

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
      fetchAll<{ symbol: string; sector: string | null; country: string | null }>(
        sb,
        "universe_members",
        "symbol, sector, country",
        (q) => q.eq("is_active", true)
      ),
    ]);

    const tapeLive = liveTape(radar, universe);
    const inputs = (brief?.inputs && typeof brief.inputs === "object")
      ? brief.inputs as Record<string, unknown>
      : {};

    let stale = false;
    if (brief?.asof_date) {
      const asOf = new Date(brief.asof_date);
      const diffDays = (Date.now() - asOf.getTime()) / (1000 * 60 * 60 * 24);
      stale = diffDays > 3;
    }

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

    const regionOf = new Map<string, string>();
    for (const u of universe) {
      const country = u.country ?? "";
      if (country === "US") regionOf.set(u.symbol, "US");
      else if (country === "GB") regionOf.set(u.symbol, "UK");
      else if (["DE", "FR", "NL", "ES", "IT", "CH", "IE"].includes(country)) regionOf.set(u.symbol, "EU");
      else regionOf.set(u.symbol, "Other");
    }
    const regionBreadth: Record<string, number> = {};
    for (const region of ["US", "UK", "EU", "Other"]) {
      const rows = radar.filter((r) => regionOf.get(r.symbol) === region);
      if (rows.length) {
        regionBreadth[region] = Math.round(
          (rows.filter((r) => r.state === 1).length / rows.length) * 1000
        ) / 10;
      }
    }

    const avgRank = tapeLive.total > 0
      ? Math.round(radar.reduce((s, r) => s + r.quality_rank, 0) / tapeLive.total)
      : 0;

    const sess = sessionState();
    const closed = lastClosedSession();
    const storedBrief = typeof brief?.brief === "string" ? brief.brief : null;

    return NextResponse.json({
      asOfDate: tapeDate ?? brief?.asof_date ?? null,
      briefText: tapeLive.briefText,
      storedBrief,
      briefSource: "live_radar",
      posture: tapeLive.posture,
      postureLabel: tapeLive.postureLabel,
      breadth: {
        total: tapeLive.total,
        greens: tapeLive.greens,
        reds: tapeLive.reds,
        greys: tapeLive.greys,
        pctGreen: tapeLive.pctGreen,
        pctRed: tapeLive.pctRed,
        pctGrey: tapeLive.pctGrey,
      },
      avgRank,
      bestSector: tapeLive.bestSector,
      worstSector: tapeLive.worstSector,
      bestSectorScore: tapeLive.bestSectorScore,
      worstSectorScore: tapeLive.worstSectorScore,
      sectors: tapeLive.sectors,
      regionBreadth: Object.keys(regionBreadth).length
        ? regionBreadth
        : (inputs.region_breadth as Record<string, number> | undefined) ?? {},
      stale: stale || (tapeDate != null && tapeDate < closed) || (storedBrief != null && storedBrief !== tapeLive.briefText),
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
