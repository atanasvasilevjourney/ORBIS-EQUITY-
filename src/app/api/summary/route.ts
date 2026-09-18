import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const sb = createServerClient();

    const { data: brief } = await sb
      .from("daily_brief")
      .select("asof_date, brief, inputs")
      .order("asof_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: pxRows } = await sb
      .from("prices_daily")
      .select("date")
      .order("date", { ascending: false })
      .limit(1);

    const radar = await fetchAll<{ state: number; quality_rank: number }>(
      sb,
      "trend_radar",
      "state, quality_rank"
    );

    const total = radar.length;
    const greens = radar.filter((r) => r.state === 1).length;
    const reds = radar.filter((r) => r.state === -1).length;
    const avgRank = total > 0
      ? Math.round(radar.reduce((s, r) => s + r.quality_rank, 0) / total)
      : 0;

    const inputs = (brief?.inputs && typeof brief.inputs === "object")
      ? brief.inputs as Record<string, unknown>
      : {};

    const briefAsOf = brief?.asof_date ? String(brief.asof_date).slice(0, 10) : null;
    const priceAsOf = Array.isArray(pxRows) && pxRows[0]?.date ? String(pxRows[0].date).slice(0, 10) : null;
    const asOfDate = priceAsOf ?? briefAsOf;

    let stale = false;
    if (asOfDate) {
      const asOf = new Date(asOfDate);
      const diffDays = (Date.now() - asOf.getTime()) / (1000 * 60 * 60 * 24);
      stale = diffDays > 3;
    }

    const breadth = inputs.breadth as Record<string, unknown> | undefined;

    return NextResponse.json({
      asOfDate,
      priceAsOf,
      briefAsOf,
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
      bestSector: breadth?.best_sector ?? null,
      worstSector: breadth?.worst_sector ?? null,
      regionBreadth: inputs.region_breadth ?? {},
      stale,
    });
  } catch (err) {
    console.error("Summary API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
