import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunRow = {
  run_id: string;
  asof_date: string;
  session_date: string;
  names: number | null;
  breakouts: number | null;
  headline: string | null;
  computed_at: string | null;
};

type WatchRow = {
  symbol: string;
  run_id: string | null;
  company_name: string | null;
  gap_pct: number | null;
  prev_close: number | null;
  open_px: number | null;
  or_high: number | null;
  or_low: number | null;
  or_range: number | null;
  status: string;
  entry: number | null;
  stop: number | null;
  take_profit: number | null;
  shares: number | null;
  breakout_at: string | null;
  last_px: number | null;
  r_multiple: number | null;
  bars: unknown;
};

type OrderRow = {
  id: string;
  run_id: string;
  ticker: string;
  action: string;
  type: string;
  shares: number;
  limit_price: number | null;
  stop_price: number | null;
  take_profit: number | null;
  reason: string | null;
};

export async function GET() {
  try {
    const sb = createServerClient();
    const runs = await fetchAll<RunRow>(
      sb,
      "orb_runs",
      "run_id, asof_date, session_date, names, breakouts, headline, computed_at",
      (q) => q.order("computed_at", { ascending: false })
    );
    const latest = runs[0] ?? null;
    if (!latest) {
      return NextResponse.json({
        summary: null,
        watch: [],
        orders: [],
        headline: null,
        stale: true,
      });
    }

    const [watch, orders] = await Promise.all([
      fetchAll<WatchRow>(
        sb,
        "orb_watch",
        `symbol, run_id, company_name, gap_pct, prev_close, open_px, or_high, or_low,
         or_range, status, entry, stop, take_profit, shares, breakout_at, last_px, r_multiple, bars`
      ),
      fetchAll<OrderRow>(
        sb,
        "orb_orders",
        "id, run_id, ticker, action, type, shares, limit_price, stop_price, take_profit, reason"
      ),
    ]);

    const names = watch
      .filter((w) => w.run_id === latest.run_id)
      .map((w) => ({
        ticker: w.symbol,
        companyName: w.company_name ?? "",
        gapPct: w.gap_pct,
        prevClose: w.prev_close,
        open: w.open_px,
        orHigh: w.or_high,
        orLow: w.or_low,
        orRange: w.or_range,
        status: w.status,
        entry: w.entry,
        stop: w.stop,
        takeProfit: w.take_profit,
        shares: w.shares,
        breakoutAt: w.breakout_at,
        last: w.last_px,
        rMultiple: w.r_multiple,
        bars: w.bars ?? [],
      }))
      .sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0));

    let stale = false;
    if (latest.session_date) {
      const diff = (Date.now() - new Date(latest.session_date).getTime()) / 86400000;
      stale = diff > 3;
    }

    return NextResponse.json({
      summary: {
        names: latest.names,
        breakouts: latest.breakouts,
        asOfDate: latest.asof_date,
        sessionDate: latest.session_date,
        runId: latest.run_id,
        lastRunAt: latest.computed_at,
      },
      watch: names,
      orders: orders
        .filter((o) => o.run_id === latest.run_id)
        .map((o) => ({
          id: o.id,
          ticker: o.ticker,
          action: o.action,
          type: o.type,
          shares: o.shares,
          limitPrice: o.limit_price,
          stopPrice: o.stop_price,
          takeProfit: o.take_profit,
          reason: o.reason,
        })),
      headline: latest.headline,
      stale,
    });
  } catch (err) {
    console.error("ORB API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
