import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunRow = {
  run_id: string;
  asof_date: string;
  names: number | null;
  n_sectors: number | null;
  n_industries: number | null;
  regime: string | null;
  headline: string | null;
  config: Record<string, unknown> | null;
  computed_at: string | null;
};

type GroupRow = {
  group_type: string;
  name: string;
  run_id: string | null;
  n_names: number | null;
  tickers: string[] | null;
  current_breadth: number | null;
  mom_breadth: number | null;
  value_breadth: number | null;
  lowvol_breadth: number | null;
  avg_trend: number | null;
  impulse: number | null;
  beta_60: number | null;
  rs_4w: number | null;
  stretch_pct: number | null;
  label: string | null;
  score: number | null;
  bucket: string | null;
  heatmap: (number | null)[] | null;
  leaders: string[] | null;
};

function mapGroup(r: GroupRow) {
  return {
    groupType: r.group_type,
    name: r.name,
    nNames: r.n_names ?? 0,
    tickers: r.tickers ?? [],
    currentBreadth: r.current_breadth,
    momBreadth: r.mom_breadth,
    valueBreadth: r.value_breadth,
    lowvolBreadth: r.lowvol_breadth,
    avgTrend: r.avg_trend,
    impulse: r.impulse,
    beta60: r.beta_60,
    rs4w: r.rs_4w,
    stretchPct: r.stretch_pct,
    label: r.label,
    score: r.score,
    bucket: r.bucket,
    heatmap: Array.isArray(r.heatmap) ? r.heatmap : [],
    leaders: r.leaders ?? [],
  };
}

export async function GET() {
  try {
    const sb = createServerClient();
    const runs = await fetchAll<RunRow>(
      sb,
      "sector_rotation_runs",
      "run_id, asof_date, names, n_sectors, n_industries, regime, headline, config, computed_at",
      (q) => q.order("computed_at", { ascending: false })
    );
    const latest = runs[0] ?? null;
    if (!latest) {
      return NextResponse.json({
        summary: null,
        sectors: [],
        industries: [],
        headline: null,
        config: null,
        stale: true,
      });
    }
    const rows = await fetchAll<GroupRow>(sb, "sector_rotation_groups", "*");
    const groups = rows.filter((r) => r.run_id === latest.run_id).map(mapGroup);
    const sectors = groups
      .filter((g) => g.groupType === "sector")
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const industries = groups
      .filter((g) => g.groupType === "industry")
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    let stale = false;
    if (latest.asof_date) {
      stale = (Date.now() - new Date(latest.asof_date).getTime()) / 86400000 > 3;
    }
    const leading = sectors.filter((s) => s.label === "LEAD" || s.label === "ACCEL").length;
    const fading = sectors.filter((s) => s.label === "FADE" || s.label === "LAG").length;
    return NextResponse.json({
      summary: {
        names: latest.names,
        nSectors: latest.n_sectors,
        nIndustries: latest.n_industries,
        regime: latest.regime,
        asOfDate: latest.asof_date,
        leading,
        fading,
        lastRunAt: latest.computed_at,
      },
      sectors,
      industries,
      headline: latest.headline,
      config: latest.config,
      stale,
    });
  } catch (err) {
    console.error("Rotate API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
