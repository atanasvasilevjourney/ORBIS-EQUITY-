import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { isMissingRelation } from "@/lib/supabase/errors";
import {
  EMA200_DEFAULTS,
  classifyEma200Setup,
  tradingViewUrl,
  type Ema200FeatureRow,
} from "@/lib/ema200Watchlist";

export const revalidate = 900;

type FeatureDbRow = {
  symbol: string;
  bar_date: string;
  close: number | null;
  ema200: number | null;
  dist_atr: number | null;
  days_above: number | null;
  ema200_slope: number | null;
  rvol: number | null;
  regime: string | null;
};

type UniverseRow = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  country: string | null;
};

type FundRow = {
  symbol: string;
  price: number | null;
  market_cap: number | null;
  average_volume: number | null;
};

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 500);
    const showAllNear = sp.get("near") === "1";

    const sb = createServerClient();

    let features: FeatureDbRow[] = [];
    try {
      features = await fetchAll<FeatureDbRow>(
        sb,
        "ema200_features",
        "symbol, bar_date, close, ema200, dist_atr, days_above, ema200_slope, rvol, regime"
      );
    } catch (err) {
      if (!isMissingRelation(err)) throw err;
    }

    if (!features.length) {
      return NextResponse.json({
        mode: "watchlist_only",
        asOfDate: null,
        disclaimer:
          "Discretionary scan only — not a trade signal. Run migration 021 and pipeline.ema200_scanner.jobs.nightly to populate features.",
        rows: [],
      });
    }

    const latestDate = features.reduce(
      (max, r) => (r.bar_date > max ? r.bar_date : max),
      features[0].bar_date
    );
    const latestRows = features.filter((r) => r.bar_date === latestDate);

    const opts = showAllNear
      ? { ...EMA200_DEFAULTS, requireUptrend: false, requireCloseAboveEma: false }
      : EMA200_DEFAULTS;

    const [universe, fundamentals] = await Promise.all([
      fetchAll<UniverseRow>(
        sb,
        "universe_members",
        "symbol, company_name, sector, country",
        (q) => q.eq("is_active", true)
      ),
      fetchAll<FundRow>(
        sb,
        "fundamentals_snapshot",
        "symbol, price, market_cap, average_volume"
      ),
    ]);
    const uMap = new Map(universe.map((u) => [u.symbol, u]));
    const fMap = new Map(fundamentals.map((f) => [f.symbol, f]));

    const rows = latestRows
      .map((r) => {
        const feat: Ema200FeatureRow = {
          symbol: r.symbol,
          bar_date: r.bar_date,
          close: r.close,
          ema200: r.ema200,
          dist_atr: r.dist_atr,
          days_above: r.days_above,
          ema200_slope: r.ema200_slope,
          rvol: r.rvol,
          regime: r.regime,
        };
        const setup = classifyEma200Setup(feat, opts);
        if (!setup) return null;
        const u = uMap.get(r.symbol);
        const f = fMap.get(r.symbol);
        return {
          symbol: r.symbol,
          companyName: u?.company_name ?? "",
          sector: u?.sector ?? "",
          country: u?.country ?? "",
          barDate: r.bar_date,
          setup,
          close: r.close,
          ema200: r.ema200,
          distAtr: r.dist_atr,
          daysAbove: r.days_above,
          ema200Slope: r.ema200_slope,
          rvol: r.rvol,
          regime: r.regime,
          marketCap: f?.market_cap ?? null,
          price: f?.price ?? r.close,
          tradingViewUrl: tradingViewUrl(r.symbol),
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(a!.distAtr ?? 99) - Math.abs(b!.distAtr ?? 99))
      .slice(0, limit);

    return NextResponse.json({
      mode: "watchlist_only",
      asOfDate: latestDate,
      disclaimer:
        "EMA200 retrace watchlist for discretionary review only. You decide entries and exits in IBKR. No automated orders.",
      filter: showAllNear ? "near_ema_relaxed" : "retrace_held_default",
      rows,
    });
  } catch (err) {
    console.error("EMA200 watchlist API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
