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
  computed_at: string | null;
};

type NameRow = {
  symbol: string;
  run_id: string | null;
  company_name: string | null;
  spot: number | null;
  atm_iv: number | null;
  iv_trading: number | null;
  front_dte: number | null;
  front_expiry: string | null;
  put_skew: number | null;
  call_skew: number | null;
  risk_reversal: number | null;
  butterfly: number | null;
  term_slope: number | null;
  weekend_iv: number | null;
  weekend_ratio: number | null;
  weekend_var_share: number | null;
  n_expiries: number | null;
  slices: unknown;
  term: unknown;
  surface: unknown;
  weekend: unknown;
  computed_at: string | null;
};

export async function GET() {
  try {
    const sb = createServerClient();
    const runs = await fetchAll<RunRow>(
      sb,
      "skew_runs",
      "run_id, asof_date, names, headline, computed_at",
      (q) => q.order("computed_at", { ascending: false })
    );
    const latest = runs[0] ?? null;
    if (!latest) {
      return NextResponse.json({
        summary: null,
        names: [],
        headline: null,
        stale: true,
      });
    }

    const rows = await fetchAll<NameRow>(
      sb,
      "skew_names",
      `symbol, run_id, company_name, spot, atm_iv, iv_trading, front_dte, front_expiry,
       put_skew, call_skew, risk_reversal, butterfly, term_slope, weekend_iv,
       weekend_ratio, weekend_var_share, n_expiries, slices, term, surface, weekend, computed_at`
    );
    const names = rows
      .filter((r) => r.run_id === latest.run_id)
      .map((r) => ({
        ticker: r.symbol,
        companyName: r.company_name ?? "",
        spot: r.spot,
        atmIv: r.atm_iv,
        ivTrading: r.iv_trading,
        frontDte: r.front_dte,
        frontExpiry: r.front_expiry,
        putSkew: r.put_skew,
        callSkew: r.call_skew,
        riskReversal: r.risk_reversal,
        butterfly: r.butterfly,
        termSlope: r.term_slope,
        weekendIv: r.weekend_iv,
        weekendRatio: r.weekend_ratio,
        weekendVarShare: r.weekend_var_share,
        nExpiries: r.n_expiries,
        slices: r.slices ?? [],
        term: r.term ?? [],
        surface: r.surface ?? [],
        weekend: r.weekend,
        computedAt: r.computed_at,
      }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker));

    const atm = names.map((n) => n.atmIv).filter((v): v is number => v != null);
    const wk = names.map((n) => n.weekendRatio).filter((v): v is number => v != null);
    const puts = names.map((n) => n.putSkew).filter((v): v is number => v != null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const richest = names.reduce<(typeof names)[0] | null>((best, n) => {
      if (n.weekendRatio == null) return best;
      if (!best || Math.abs(n.weekendRatio) > Math.abs(best.weekendRatio ?? 0)) return n;
      return best;
    }, null);

    let stale = false;
    if (latest.asof_date) {
      const diff = (Date.now() - new Date(latest.asof_date).getTime()) / 86400000;
      stale = diff > 3;
    }

    return NextResponse.json({
      summary: {
        names: latest.names,
        asOfDate: latest.asof_date,
        runId: latest.run_id,
        lastRunAt: latest.computed_at,
        avgAtmIv: avg(atm),
        avgPutSkew: avg(puts),
        avgWeekendRatio: avg(wk),
        weekendRichest: richest?.ticker ?? null,
        weekendRichestRatio: richest?.weekendRatio ?? null,
      },
      names,
      headline: latest.headline,
      stale,
    });
  } catch (err) {
    console.error("Skew API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
