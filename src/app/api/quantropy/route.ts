import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunRow = {
  run_id: string;
  asof_date: string;
  names: number | null;
  headline: string | null;
  allocations: Record<string, unknown> | null;
  frontier: unknown;
  computed_at: string | null;
};

type NameRow = {
  symbol: string;
  run_id: string | null;
  company_name: string | null;
  last_px: number | null;
  ann_return: number | null;
  ann_vol: number | null;
  downside_vol: number | null;
  sharpe: number | null;
  sortino: number | null;
  max_drawdown: number | null;
  var_95: number | null;
  cvar_95: number | null;
  beta: number | null;
  alpha: number | null;
  info_ratio: number | null;
  altman_z: number | null;
  altman_zone: string | null;
  w_equal: number | null;
  w_inv_vol: number | null;
  w_min_var: number | null;
  w_max_sharpe: number | null;
};

export async function GET() {
  try {
    const sb = createServerClient();
    const runs = await fetchAll<RunRow>(
      sb,
      "quantropy_runs",
      "run_id, asof_date, names, headline, allocations, frontier, computed_at",
      (q) => q.order("computed_at", { ascending: false })
    );
    const latest = runs[0] ?? null;
    if (!latest) {
      return NextResponse.json({ summary: null, names: [], allocations: null, frontier: [], headline: null, stale: true });
    }
    const rows = await fetchAll<NameRow>(
      sb,
      "quantropy_names",
      `symbol, run_id, company_name, last_px, ann_return, ann_vol, downside_vol, sharpe, sortino,
       max_drawdown, var_95, cvar_95, beta, alpha, info_ratio, altman_z, altman_zone,
       w_equal, w_inv_vol, w_min_var, w_max_sharpe`
    );
    const names = rows
      .filter((r) => r.run_id === latest.run_id)
      .map((r) => ({
        ticker: r.symbol,
        companyName: r.company_name ?? "",
        last: r.last_px,
        annReturn: r.ann_return,
        annVol: r.ann_vol,
        downsideVol: r.downside_vol,
        sharpe: r.sharpe,
        sortino: r.sortino,
        maxDrawdown: r.max_drawdown,
        var95: r.var_95,
        cvar95: r.cvar_95,
        beta: r.beta,
        alpha: r.alpha,
        infoRatio: r.info_ratio,
        altmanZ: r.altman_z,
        altmanZone: r.altman_zone,
        wEqual: r.w_equal,
        wInvVol: r.w_inv_vol,
        wMinVar: r.w_min_var,
        wMaxSharpe: r.w_max_sharpe,
      }))
      .sort((a, b) => (b.sharpe ?? -999) - (a.sharpe ?? -999));

    let stale = false;
    if (latest.asof_date) {
      stale = (Date.now() - new Date(latest.asof_date).getTime()) / 86400000 > 3;
    }
    const distressed = names.filter((n) => n.altmanZone === "distress").length;
    const alloc = latest.allocations && typeof latest.allocations === "object" ? latest.allocations : {};

    return NextResponse.json({
      summary: {
        names: latest.names,
        asOfDate: latest.asof_date,
        runId: latest.run_id,
        lastRunAt: latest.computed_at,
        distressed,
        maxSharpe: (alloc as { maxSharpe?: { sharpe?: number } }).maxSharpe?.sharpe ?? null,
        minVol: (alloc as { minVar?: { annVol?: number } }).minVar?.annVol ?? null,
      },
      names,
      allocations: alloc,
      frontier: Array.isArray(latest.frontier) ? latest.frontier : [],
      headline: latest.headline,
      stale,
    });
  } catch (err) {
    console.error("Quantropy API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
