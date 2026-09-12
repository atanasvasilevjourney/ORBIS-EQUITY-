import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunRow = {
  run_id: string;
  asof_date: string;
  names: number | null;
  buys: number | null;
  sells: number | null;
  headline: string | null;
  computed_at: string | null;
};

type NameRow = {
  symbol: string;
  run_id: string | null;
  company_name: string | null;
  last_px: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  macd: number | null;
  rsi: number | null;
  lr_m: number | null;
  lr_code: number | null;
  lr_desc: string | null;
  mavg_long_code: number | null;
  mavg_long_desc: string | null;
  mavg_mid_code: number | null;
  mavg_mid_desc: string | null;
  dt_code: number | null;
  dt_desc: string | null;
  macd_code: number | null;
  macd_desc: string | null;
  rsi_code: number | null;
  rsi_desc: string | null;
  vote: string | null;
  buy_count: number | null;
  sell_count: number | null;
  hold_count: number | null;
  composite_score: number | null;
  f_score: number | null;
  pe_ratio: number | null;
  spark: unknown;
};

function mapName(r: NameRow) {
  return {
    ticker: r.symbol,
    companyName: r.company_name ?? "",
    last: r.last_px,
    sma50: r.sma50,
    sma100: r.sma100,
    sma200: r.sma200,
    ema20: r.ema20,
    ema50: r.ema50,
    ema100: r.ema100,
    macd: r.macd,
    rsi: r.rsi,
    lrM: r.lr_m,
    lrCode: r.lr_code,
    lrDesc: r.lr_desc,
    mavgLongCode: r.mavg_long_code,
    mavgLongDesc: r.mavg_long_desc,
    mavgMidCode: r.mavg_mid_code,
    mavgMidDesc: r.mavg_mid_desc,
    dtCode: r.dt_code,
    dtDesc: r.dt_desc,
    macdCode: r.macd_code,
    macdDesc: r.macd_desc,
    rsiCode: r.rsi_code,
    rsiDesc: r.rsi_desc,
    vote: r.vote,
    buyCount: r.buy_count,
    sellCount: r.sell_count,
    holdCount: r.hold_count,
    compositeScore: r.composite_score,
    fScore: r.f_score,
    pe: r.pe_ratio,
    spark: r.spark,
  };
}

export async function GET() {
  try {
    const sb = createServerClient();
    const runs = await fetchAll<RunRow>(
      sb,
      "analysis_runs",
      "run_id, asof_date, names, buys, sells, headline, computed_at",
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
      "analysis_names",
      `symbol, run_id, company_name, last_px, sma50, sma100, sma200, ema20, ema50, ema100,
       macd, rsi, lr_m, lr_code, lr_desc, mavg_long_code, mavg_long_desc, mavg_mid_code,
       mavg_mid_desc, dt_code, dt_desc, macd_code, macd_desc, rsi_code, rsi_desc, vote,
       buy_count, sell_count, hold_count, composite_score, f_score, pe_ratio, spark`
    );
    const names = rows
      .filter((r) => r.run_id === latest.run_id)
      .map(mapName)
      .sort((a, b) => (b.buyCount ?? 0) - (a.buyCount ?? 0) || a.ticker.localeCompare(b.ticker));

    let stale = false;
    if (latest.asof_date) {
      const diff = (Date.now() - new Date(latest.asof_date).getTime()) / 86400000;
      stale = diff > 3;
    }

    return NextResponse.json({
      summary: {
        names: latest.names,
        buys: latest.buys,
        sells: latest.sells,
        asOfDate: latest.asof_date,
        runId: latest.run_id,
        lastRunAt: latest.computed_at,
      },
      names,
      headline: latest.headline,
      stale,
    });
  } catch (err) {
    console.error("Analysis API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
