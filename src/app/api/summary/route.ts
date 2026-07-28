import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const sb = createServerClient();

  // Fetch latest daily brief (contains aggregated posture/breadth)
  const { data: brief } = await sb
    .from("daily_brief")
    .select("asof_date, brief, inputs")
    .order("asof_date", { ascending: false })
    .limit(1)
    .single();

  // Fetch trend_radar state distribution
  const { data: radar } = await sb
    .from("trend_radar")
    .select("state, quality_rank");

  const total = radar?.length ?? 0;
  const greens = radar?.filter((r) => r.state === 1).length ?? 0;
  const reds = radar?.filter((r) => r.state === -1).length ?? 0;
  const avgRank = total > 0
    ? Math.round(radar!.reduce((s, r) => s + r.quality_rank, 0) / total)
    : 0;

  // Parse stored inputs if available
  let inputs: any = {};
  if (brief?.inputs) {
    try {
      inputs = typeof brief.inputs === "string" ? JSON.parse(brief.inputs) : brief.inputs;
    } catch { /* ignore */ }
  }

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
    bestSector: inputs.breadth?.best_sector ?? null,
    worstSector: inputs.breadth?.worst_sector ?? null,
    regionBreadth: inputs.region_breadth ?? {},
  });
}
