import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const sb = createServerClient();

    type RunRow = {
      run_id: string;
      asof_date: string;
      equity: number;
      deployed_pct: number | null;
      open_risk_pct: number | null;
      names: number | null;
      posture: number | null;
      status: string | null;
      headline: string | null;
      harness: Record<string, unknown> | null;
      log: unknown;
      computed_at: string | null;
    };
    type BookRow = {
      symbol: string;
      company_name: string | null;
      side: string;
      shares: number;
      entry: number;
      last: number | null;
      stop: number | null;
      n: number | null;
      risk_usd: number | null;
      sector: string | null;
      reason: string | null;
      rank: number | null;
      breakout: boolean | null;
      green: boolean | null;
      unrealized_pnl_usd: number | null;
      days_held: number | null;
    };
    type OrderRow = {
      id: string;
      run_id: string;
      ticker: string;
      action: string;
      type: string;
      shares: number;
      limit_price: number | null;
      reason: string | null;
      sector: string | null;
      risk_usd: number | null;
    };

    const runs = await fetchAll<RunRow>(
      sb,
      "paper_loop_runs",
      "run_id, asof_date, equity, deployed_pct, open_risk_pct, names, posture, status, headline, harness, log, computed_at",
      (q) => q.order("computed_at", { ascending: false })
    );
    const latest = runs[0] ?? null;
    if (!latest) {
      return NextResponse.json({
        summary: null,
        book: [],
        orders: [],
        harness: { sectorExposure: [], skipped: [], config: null },
        log: [],
        headline: null,
        stale: true,
      });
    }

    const [book, allOrders] = await Promise.all([
      fetchAll<BookRow>(sb, "paper_book", `
        symbol, company_name, side, shares, entry, last, stop, n, risk_usd,
        sector, reason, rank, breakout, green, unrealized_pnl_usd, days_held
      `),
      fetchAll<OrderRow>(sb, "paper_orders", "id, run_id, ticker, action, type, shares, limit_price, reason, sector, risk_usd"),
    ]);

    const orders = allOrders.filter((o) => o.run_id === latest.run_id);
    const harness = (latest.harness && typeof latest.harness === "object")
      ? latest.harness as {
          sectorExposure?: unknown[];
          skipped?: unknown[];
          config?: Record<string, unknown> | null;
        }
      : { sectorExposure: [], skipped: [], config: null };

    let stale = false;
    if (latest.asof_date) {
      const diff = (Date.now() - new Date(latest.asof_date).getTime()) / 86400000;
      stale = diff > 3;
    }

    return NextResponse.json({
      summary: {
        equity: latest.equity,
        deployedPct: latest.deployed_pct,
        openRiskPct: latest.open_risk_pct,
        names: latest.names,
        lastLoopRunAt: latest.computed_at,
        asOfDate: latest.asof_date,
        runId: latest.run_id,
        status: latest.status,
        posture: latest.posture,
      },
      book: book
        .map((p) => ({
          ticker: p.symbol,
          companyName: p.company_name ?? "",
          side: p.side,
          shares: p.shares,
          entry: p.entry,
          last: p.last,
          stop: p.stop,
          n: p.n,
          riskUsd: p.risk_usd,
          sector: p.sector ?? "",
          reason: p.reason ?? "",
          rank: p.rank,
          breakout: p.breakout,
          green: p.green,
          unrealizedPnlUsd: p.unrealized_pnl_usd,
          daysHeld: p.days_held,
        }))
        .sort((a, b) => (b.riskUsd ?? 0) - (a.riskUsd ?? 0)),
      orders: orders.map((o) => ({
        id: o.id,
        ticker: o.ticker,
        action: o.action,
        shares: o.shares,
        type: o.type,
        limitPrice: o.limit_price,
        reason: o.reason,
        sector: o.sector,
        riskUsd: o.risk_usd,
      })),
      harness: {
        sectorExposure: harness.sectorExposure ?? [],
        skipped: harness.skipped ?? [],
        config: harness.config ?? null,
      },
      log: Array.isArray(latest.log) ? latest.log : [],
      headline: latest.headline,
      stale,
    });
  } catch (err) {
    console.error("Loop API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
