import { NextResponse } from "next/server";
import { legsFromBooks, type CapitalLeg } from "@/lib/capitalBook";
import type { ActiveDesk, ActivePayload } from "@/lib/portfolio/activeBook";
import { evaluateFreshness } from "@/lib/freshness";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunRow = { run_id: string; asof_date: string | null; computed_at: string | null };

function latestRun(rows: RunRow[]): RunRow | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => (b.computed_at ?? "").localeCompare(a.computed_at ?? ""))[0];
}

function emptyPayload(unavailable: boolean): ActivePayload {
  const desks: ActiveDesk[] = (["LOOP", "ORB", "CASH", "ROTATE"] as const).map((sleeve) => ({
    sleeve,
    asOf: null,
    ran: false,
    stale: false,
    suppressed: false,
    open: 0,
  }));
  return { unavailable, desks, legs: [] };
}

export async function GET() {
  try {
    const sb = createServerClient();
    const [loopBook, loopRuns, orbWatch, orbRuns, cashNames, cashRuns, rotateRows, rotateRuns] = await Promise.all([
      fetchAll<{
        symbol: string;
        side: string | null;
        shares: number | null;
        last: number | null;
        unrealized_pnl_usd: number | null;
        days_held: number | null;
      }>(sb, "paper_book", "symbol, side, shares, last, unrealized_pnl_usd, days_held"),
      fetchAll<RunRow>(sb, "paper_loop_runs", "run_id, asof_date, computed_at"),
      fetchAll<{
        symbol: string;
        run_id: string | null;
        status: string | null;
        shares: number | null;
        last_px: number | null;
        entry: number | null;
      }>(sb, "orb_watch", "symbol, run_id, status, shares, last_px, entry"),
      fetchAll<RunRow>(sb, "orb_runs", "run_id, asof_date, computed_at"),
      fetchAll<{
        symbol: string;
        run_id: string | null;
        in_tema_book: boolean | null;
        tema_side: string | null;
        tema_notional: number | null;
        in_carver_book: boolean | null;
        carver_side: string | null;
        carver_notional: number | null;
      }>(
        sb,
        "perp_names",
        "symbol, run_id, in_tema_book, tema_side, tema_notional, in_carver_book, carver_side, carver_notional",
      ),
      fetchAll<RunRow>(sb, "perp_runs", "run_id, asof_date, computed_at"),
      fetchAll<{
        symbol: string;
        run_id: string | null;
        side: string | null;
        notional: number | null;
      }>(sb, "sector_rotation_carver", "symbol, run_id, side, notional"),
      fetchAll<RunRow>(sb, "sector_rotation_runs", "run_id, asof_date, computed_at"),
    ]);

    const loopLatest = latestRun(loopRuns);
    const orbLatest = latestRun(orbRuns);
    const cashLatest = latestRun(cashRuns);
    const rotateLatest = latestRun(rotateRuns);
    const loopFresh = loopLatest ? evaluateFreshness(loopLatest.asof_date) : null;
    const orbFresh = orbLatest ? evaluateFreshness(orbLatest.asof_date) : null;
    const cashFresh = cashLatest ? evaluateFreshness(cashLatest.asof_date) : null;
    const rotateFresh = rotateLatest ? evaluateFreshness(rotateLatest.asof_date) : null;

    const orbRows = orbLatest ? orbWatch.filter((row) => row.run_id === orbLatest.run_id) : [];
    const cashRows = cashLatest ? cashNames.filter((row) => row.run_id === cashLatest.run_id) : [];
    const rotateBook = rotateLatest ? rotateRows.filter((row) => row.run_id === rotateLatest.run_id) : [];

    const legs: CapitalLeg[] = legsFromBooks({
      loopAsOf: loopLatest?.asof_date ?? null,
      loop: loopBook.map((row) => ({
        symbol: row.symbol,
        side: row.side,
        shares: row.shares,
        last: row.last,
        unrealizedPnlUsd: row.unrealized_pnl_usd,
        daysHeld: row.days_held,
      })),
      orbAsOf: orbLatest?.asof_date ?? null,
      orb: (orbFresh?.signalsSuppressed ? [] : orbRows).map((row) => ({
        symbol: row.symbol,
        status: row.status,
        shares: row.shares,
        last: row.last_px,
        entry: row.entry,
      })),
      cashAsOf: cashLatest?.asof_date ?? null,
      cash: (cashFresh?.signalsSuppressed ? [] : cashRows).map((row) => ({
        symbol: row.symbol,
        inTema: !!row.in_tema_book,
        temaSide: row.tema_side,
        temaNotional: row.tema_notional,
        inCarver: !!row.in_carver_book,
        carverSide: row.carver_side,
        carverNotional: row.carver_notional,
      })),
      rotateAsOf: rotateLatest?.asof_date ?? null,
      rotate: (rotateFresh?.signalsSuppressed ? [] : rotateBook).map((row) => ({
        symbol: row.symbol,
        side: row.side,
        notional: row.notional,
      })),
    });

    const openNames = (sleeve: CapitalLeg["sleeve"]) =>
      new Set(legs.filter((leg) => leg.sleeve === sleeve).map((leg) => leg.symbol)).size;

    const desks: ActiveDesk[] = [
      {
        sleeve: "LOOP",
        asOf: loopLatest?.asof_date ?? null,
        ran: !!loopLatest,
        stale: loopFresh?.stale ?? false,
        suppressed: false,
        open: openNames("LOOP"),
      },
      {
        sleeve: "ORB",
        asOf: orbLatest?.asof_date ?? null,
        ran: !!orbLatest,
        stale: orbFresh?.stale ?? false,
        suppressed: orbFresh?.signalsSuppressed ?? false,
        open: openNames("ORB"),
      },
      {
        sleeve: "CASH",
        asOf: cashLatest?.asof_date ?? null,
        ran: !!cashLatest,
        stale: cashFresh?.stale ?? false,
        suppressed: cashFresh?.signalsSuppressed ?? false,
        open: openNames("CASH"),
      },
      {
        sleeve: "ROTATE",
        asOf: rotateLatest?.asof_date ?? null,
        ran: !!rotateLatest,
        stale: rotateFresh?.stale ?? false,
        suppressed: rotateFresh?.signalsSuppressed ?? false,
        open: openNames("ROTATE"),
      },
    ];

    const body: ActivePayload = { unavailable: false, desks, legs };
    return NextResponse.json(body);
  } catch (err) {
    console.error("Active trading book error:", err);
    return NextResponse.json(emptyPayload(true));
  }
}
