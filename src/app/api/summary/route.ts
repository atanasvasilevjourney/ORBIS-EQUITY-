import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

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

    let stale = false;
    if (brief?.asof_date) {
      const asOf = new Date(brief.asof_date);
      const diffDays = (Date.now() - asOf.getTime()) / (1000 * 60 * 60 * 24);
      stale = diffDays > 3;
    }

    const breadth = inputs.breadth as Record<string, unknown> | undefined;

    return NextResponse.json({
      asOfDate: brief?.asof_date ?? null,
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
