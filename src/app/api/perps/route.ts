import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunRow = {
  run_id: string;
  asof_date: string;
  names: number | null;
  tema_slots: number | null;
  carver_slots: number | null;
  gross_leverage: number | null;
  headline: string | null;
  config: Record<string, unknown> | null;
  computed_at: string | null;
};

type NameRow = {
  symbol: string;
  run_id: string | null;
  company_name: string | null;
  sector: string | null;
  last_px: number | null;
  perp_symbol: string | null;
  venue: string | null;
  venue_listed: boolean | null;
  mark_px: number | null;
  funding_8h: number | null;
  funding_ann: number | null;
  tema_side: string | null;
  tema_grade: string | null;
  tema_score: number | null;
  tema_t8: number | null;
  tema_t21: number | null;
  tema_t55: number | null;
  tema_stop: number | null;
  tema_tp: number | null;
  tema_weight_pct: number | null;
  tema_notional: number | null;
  tema_leverage: number | null;
  tema_margin: number | null;
  tema_liq: number | null;
  carver_forecast: number | null;
  carver_ewmac_fast: number | null;
  carver_ewmac_slow: number | null;
  carver_vol: number | null;
  carver_side: string | null;
  carver_notional: number | null;
  carver_leverage: number | null;
  carver_margin: number | null;
  carver_liq: number | null;
  atr: number | null;
  atr_pct: number | null;
  in_tema_book: boolean | null;
  in_carver_book: boolean | null;
  skip_reason: string | null;
  rationale: string | null;
};

function mapName(r: NameRow) {
  return {
    ticker: r.symbol,
    companyName: r.company_name ?? "",
    sector: r.sector ?? "",
    last: r.last_px,
    perpSymbol: r.perp_symbol,
    venue: r.venue,
    venueListed: Boolean(r.venue_listed),
    mark: r.mark_px,
    funding8h: r.funding_8h,
    fundingAnn: r.funding_ann,
    temaSide: r.tema_side,
    temaGrade: r.tema_grade,
    temaScore: r.tema_score,
    temaT9: r.tema_t8,
    temaT99: r.tema_t21,
    temaT199: r.tema_t55,
    temaT8: r.tema_t8,
    temaT21: r.tema_t21,
    temaT55: r.tema_t55,
    temaStop: r.tema_stop,
    temaTp: r.tema_tp,
    temaWeightPct: r.tema_weight_pct,
    temaNotional: r.tema_notional,
    temaLeverage: r.tema_leverage,
    temaMargin: r.tema_margin,
    temaLiq: r.tema_liq,
    carverForecast: r.carver_forecast,
    carverEwmacFast: r.carver_ewmac_fast,
    carverEwmacSlow: r.carver_ewmac_slow,
    carverVol: r.carver_vol,
    carverSide: r.carver_side,
    carverNotional: r.carver_notional,
    carverLeverage: r.carver_leverage,
    carverMargin: r.carver_margin,
    carverLiq: r.carver_liq,
    atr: r.atr,
    atrPct: r.atr_pct,
    inTemaBook: Boolean(r.in_tema_book),
    inCarverBook: Boolean(r.in_carver_book),
    skipReason: r.skip_reason,
    rationale: r.rationale,
  };
}

export async function GET() {
  try {
    const sb = createServerClient();
    const runs = await fetchAll<RunRow>(
      sb,
      "perp_runs",
      "run_id, asof_date, names, tema_slots, carver_slots, gross_leverage, headline, config, computed_at",
      (q) => q.order("computed_at", { ascending: false })
    );
    const latest = runs[0] ?? null;
    if (!latest) {
      return NextResponse.json({
        summary: null,
        names: [],
        temaBook: [],
        carverBook: [],
        headline: null,
        config: null,
        stale: true,
      });
    }
    const rows = await fetchAll<NameRow>(sb, "perp_names", "*");
    const names = rows.filter((r) => r.run_id === latest.run_id).map(mapName);
    const temaBook = names
      .filter((n) => n.inTemaBook)
      .sort((a, b) => (b.temaScore ?? 0) - (a.temaScore ?? 0));
    const carverBook = names
      .filter((n) => n.inCarverBook)
      .sort((a, b) => Math.abs(b.carverForecast ?? 0) - Math.abs(a.carverForecast ?? 0));

    let stale = false;
    if (latest.asof_date) {
      stale = (Date.now() - new Date(latest.asof_date).getTime()) / 86400000 > 3;
    }
    const listed = names.filter((n) => n.venueListed).length;
    const cfg = latest.config && typeof latest.config === "object" ? latest.config : {};
    return NextResponse.json({
      summary: {
        names: latest.names,
        temaSlots: latest.tema_slots,
        carverSlots: latest.carver_slots,
        grossLeverage: latest.gross_leverage,
        asOfDate: latest.asof_date,
        runId: latest.run_id,
        lastRunAt: latest.computed_at,
        listed,
        synthetic: names.length - listed,
        regime: typeof cfg.regime === "string" ? cfg.regime : "LIVE",
        drawdown: typeof cfg.drawdown === "number" ? cfg.drawdown : null,
        ddScalar: typeof cfg.ddScalar === "number" ? cfg.ddScalar : null,
        maxDrawdown: typeof cfg.maxDrawdown === "number" ? cfg.maxDrawdown : null,
        activeForecasts: typeof cfg.activeForecasts === "number" ? cfg.activeForecasts : null,
      },
      names: names.sort((a, b) => a.ticker.localeCompare(b.ticker)),
      temaBook,
      carverBook,
      headline: latest.headline,
      config: latest.config,
      stale,
    });
  } catch (err) {
    console.error("Perps API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
