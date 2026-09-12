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
  canary_score: number | null;
  canary_on: number | null;
  canary_off: number | null;
  n_triggers: number | null;
  n_carver: number | null;
  carver_rungs: number | null;
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
  aligned: boolean | null;
  parent_sector: string | null;
};

type CanaryRow = {
  name: string;
  pair: string | null;
  z: number | null;
  smooth: number | null;
  vote: number | null;
  implication: string | null;
  proxy: boolean | null;
  run_id: string | null;
};

type TriggerRow = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  ensemble: number | null;
  n_long: number | null;
  n_short: number | null;
  n_cfg: number | null;
  triggered: string | null;
  tema_side: string | null;
  tema_grade: string | null;
  macd_action: string | null;
  aligned: boolean | null;
  group_label: string | null;
  run_id: string | null;
};

type CarverRow = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  forecast: number | null;
  parent_forecast: number | null;
  sleeve_forecast: number | null;
  xs_score: number | null;
  xs_rank: number | null;
  sleeve_rank: number | null;
  unlocked: number | null;
  rungs: number | null;
  weight: number | null;
  notional: number | null;
  side: string | null;
  action: string | null;
  aligned: boolean | null;
  run_id: string | null;
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
    aligned: Boolean(r.aligned),
    parentSector: r.parent_sector ?? null,
  };
}

export async function GET() {
  try {
    const sb = createServerClient();
    const runs = await fetchAll<RunRow>(
      sb,
      "sector_rotation_runs",
      "run_id, asof_date, names, n_sectors, n_industries, regime, canary_score, canary_on, canary_off, n_triggers, n_carver, carver_rungs, headline, config, computed_at",
      (q) => q.order("computed_at", { ascending: false })
    );
    const latest = runs[0] ?? null;
    if (!latest) {
      return NextResponse.json({
        summary: null,
        sectors: [],
        industries: [],
        canaries: [],
        triggers: [],
        carver: [],
        headline: null,
        config: null,
        stale: true,
      });
    }
    const [rows, canaryRows, triggerRows, carverRows] = await Promise.all([
      fetchAll<GroupRow>(sb, "sector_rotation_groups", "*"),
      fetchAll<CanaryRow>(sb, "sector_rotation_canaries", "*").catch(() => []),
      fetchAll<TriggerRow>(sb, "sector_rotation_triggers", "*").catch(() => []),
      fetchAll<CarverRow>(sb, "sector_rotation_carver", "*").catch(() => []),
    ]);
    const groups = rows.filter((r) => r.run_id === latest.run_id).map(mapGroup);
    const sectors = groups
      .filter((g) => g.groupType === "sector")
      .sort((a, b) => Number(b.aligned) - Number(a.aligned) || (b.score ?? 0) - (a.score ?? 0));
    const industries = groups
      .filter((g) => g.groupType === "industry")
      .sort((a, b) => Number(b.aligned) - Number(a.aligned) || (b.score ?? 0) - (a.score ?? 0));
    const canaries = canaryRows
      .filter((r) => r.run_id === latest.run_id)
      .map((r) => ({
        name: r.name,
        pair: r.pair ?? "",
        z: r.z,
        smooth: r.smooth,
        vote: r.vote ?? 0,
        implication: r.implication ?? "",
        proxy: Boolean(r.proxy),
      }));
    const triggers = triggerRows
      .filter((r) => r.run_id === latest.run_id)
      .map((r) => ({
        ticker: r.symbol,
        sector: r.sector ?? "",
        industry: r.industry ?? "",
        ensemble: r.ensemble,
        nLong: r.n_long,
        nShort: r.n_short,
        nCfg: r.n_cfg,
        triggered: r.triggered,
        temaSide: r.tema_side,
        temaGrade: r.tema_grade,
        macdAction: r.macd_action,
        aligned: Boolean(r.aligned),
        groupLabel: r.group_label,
      }))
      .sort((a, b) => Number(b.aligned) - Number(a.aligned) || (b.ensemble ?? 0) - (a.ensemble ?? 0));
    const carver = carverRows
      .filter((r) => r.run_id === latest.run_id)
      .map((r) => ({
        ticker: r.symbol,
        sector: r.sector ?? "",
        industry: r.industry ?? "",
        forecast: r.forecast,
        parentForecast: r.parent_forecast,
        sleeveForecast: r.sleeve_forecast,
        xsScore: r.xs_score,
        xsRank: r.xs_rank,
        sleeveRank: r.sleeve_rank,
        unlocked: r.unlocked ?? 0,
        rungs: r.rungs ?? 0,
        weight: r.weight,
        notional: r.notional,
        side: r.side ?? "FLAT",
        action: r.action ?? "FLAT",
        aligned: Boolean(r.aligned),
      }))
      .sort((a, b) => b.rungs - a.rungs || (a.sleeveRank ?? 99) - (b.sleeveRank ?? 99) || (a.xsRank ?? 99) - (b.xsRank ?? 99));

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
        canaryScore: latest.canary_score,
        canaryOn: latest.canary_on,
        canaryOff: latest.canary_off,
        nTriggers: latest.n_triggers,
        nCarver: latest.n_carver,
        carverRungs: latest.carver_rungs,
        asOfDate: latest.asof_date,
        leading,
        fading,
        lastRunAt: latest.computed_at,
      },
      sectors,
      industries,
      canaries,
      triggers,
      carver,
      headline: latest.headline,
      config: latest.config,
      stale,
    });
  } catch (err) {
    console.error("Rotate API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
