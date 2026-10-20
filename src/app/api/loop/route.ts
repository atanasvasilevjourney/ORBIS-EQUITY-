import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { enrichLoopBookWithPrices, tradingStaleDays } from "@/lib/loopBookMtm";
import { latestPriceAsOf } from "@/lib/liteDeskGate";
import { sectorExposureFromBook } from "@/lib/loopSectorHarness";
import { evaluateFreshness } from "@/lib/freshness";
import { closedTradesFromOrders } from "@/lib/loopClosedTrades";
import { gateOrders, staleHeadline } from "@/lib/signalGate";
import { fetchLatestStrategySignals } from "@/lib/strategySignals";

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
      opened_at: string | null;
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
      created_at: string | null;
    };
    type JournalDbRow = {
      id: string;
      symbol: string;
      side: string;
      shares: number;
      entry_price: number;
      exit_price: number;
      pnl_usd: number;
      return_pct: number | null;
      sector: string | null;
      entry_reason: string | null;
      exit_reason: string | null;
      entered_at: string | null;
      exited_at: string;
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
        journal: [],
        journalSummary: { closedTrades: 0, realizedPnlUsd: 0, winRatePct: null },
      });
    }

    const [book, allOrders] = await Promise.all([
      fetchAll<BookRow>(sb, "paper_book", `
        symbol, company_name, side, shares, entry, last, stop, n, risk_usd,
        sector, reason, rank, breakout, green, unrealized_pnl_usd, days_held, opened_at
      `),
      fetchAll<OrderRow>(
        sb,
        "paper_orders",
        "id, run_id, ticker, action, type, shares, limit_price, reason, sector, risk_usd, created_at"
      ),
    ]);

    const orders = allOrders.filter((o) => o.run_id === latest.run_id);

    const journalDb = await fetchAll<JournalDbRow>(
      sb,
      "trading_journal",
      `id, symbol, side, shares, entry_price, exit_price, pnl_usd, return_pct,
       sector, entry_reason, exit_reason, entered_at, exited_at`,
      (q) => q.eq("desk", "loop").order("exited_at", { ascending: false })
    );

    const orderInputs = allOrders.map((o) => ({
      id: o.id,
      ticker: o.ticker,
      action: o.action,
      shares: o.shares,
      limitPrice: o.limit_price,
      reason: o.reason,
      sector: o.sector,
      createdAt: o.created_at,
    }));

    const journalFromOrders = closedTradesFromOrders(orderInputs).map((t) => ({
      id: t.id,
      ticker: t.ticker,
      side: "LONG",
      shares: t.shares,
      entry: t.entry,
      exit: t.exit,
      pnlUsd: t.pnlUsd,
      returnPct: t.returnPct,
      sector: t.sector,
      entryReason: t.entryReason,
      exitReason: t.exitReason,
      enteredAt: t.enteredAt?.slice(0, 10) ?? null,
      exitedAt: t.exitedAt?.slice(0, 10) ?? null,
    }));

    const journal =
      journalDb.length > 0
        ? journalDb.map((j) => ({
            id: j.id,
            ticker: j.symbol,
            side: j.side,
            shares: j.shares,
            entry: j.entry_price,
            exit: j.exit_price,
            pnlUsd: j.pnl_usd,
            returnPct: j.return_pct,
            sector: j.sector,
            entryReason: j.entry_reason,
            exitReason: j.exit_reason,
            enteredAt: j.entered_at?.slice(0, 10) ?? null,
            exitedAt: j.exited_at?.slice(0, 10) ?? null,
          }))
        : journalFromOrders;

    const journalSummary = {
      closedTrades: journal.length,
      realizedPnlUsd: journal.reduce((s, t) => s + (t.pnlUsd ?? 0), 0),
      winRatePct:
        journal.length > 0
          ? (journal.filter((t) => (t.pnlUsd ?? 0) > 0).length / journal.length) * 100
          : null,
    };

    const entryDateByTicker = new Map<string, string>();
    const enterOrders = allOrders
      .filter((o) => o.type === "ENTER" && o.action === "BUY")
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    for (const o of enterOrders) {
      const d = o.created_at?.slice(0, 10);
      if (!d || entryDateByTicker.has(o.ticker)) continue;
      entryDateByTicker.set(o.ticker, d);
    }
    const harness = (latest.harness && typeof latest.harness === "object")
      ? latest.harness as {
          sectorExposure?: unknown[];
          skipped?: unknown[];
          config?: Record<string, unknown> | null;
        }
      : { sectorExposure: [], skipped: [], config: null };

    let freshVerdict = evaluateFreshness(latest.asof_date, null);
    let stale = freshVerdict.stale;

    const bookBase = book
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
        openedAt: p.opened_at?.slice(0, 10) ?? entryDateByTicker.get(p.symbol) ?? null,
      }))
      .sort((a, b) => (b.riskUsd ?? 0) - (a.riskUsd ?? 0));

    const tickers = bookBase.map((r) => r.ticker);
    let priceAsOfDate: string | null = null;
    let priceStaleDays: number | null = null;
    let bookOut = bookBase.map((r) => ({
      ...r,
      priceAsOfDate: null as string | null,
    }));

    if (tickers.length === 0) {
      priceAsOfDate = await latestPriceAsOf(sb);
      priceStaleDays = priceAsOfDate ? tradingStaleDays(priceAsOfDate) : null;
      freshVerdict = evaluateFreshness(latest.asof_date, priceAsOfDate);
      stale = freshVerdict.stale;
    } else if (tickers.length > 0) {
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - 30);
      const cutoffIso = cutoff.toISOString().slice(0, 10);
      const pxRows = await fetchAll<{
        symbol: string;
        date: string;
        close: number | null;
        adj_close: number | null;
      }>(
        sb,
        "prices_daily",
        "symbol, date, close, adj_close",
        (q) => q.in("symbol", tickers).gte("date", cutoffIso).order("date", { ascending: false })
      );
      const enriched = enrichLoopBookWithPrices(
        bookBase.map((r) => ({
          ticker: r.ticker,
          shares: r.shares,
          entry: r.entry,
          last: r.last,
          openedAt: r.openedAt,
          unrealizedPnlUsd: r.unrealizedPnlUsd,
          daysHeld: r.daysHeld,
        })),
        pxRows.map((r) => ({
          symbol: r.symbol,
          date: r.date,
          close: r.close,
          adj_close: r.adj_close,
        }))
      );
      priceAsOfDate = enriched.priceAsOfDate;
      priceStaleDays = tradingStaleDays(priceAsOfDate);
      freshVerdict = evaluateFreshness(latest.asof_date, priceAsOfDate);
      stale = freshVerdict.stale;
      bookOut = bookBase.map((base) => {
        const hit = enriched.rows.find((e) => e.ticker === base.ticker);
        if (!hit) return { ...base, priceAsOfDate: null };
        return {
          ...base,
          last: hit.last,
          unrealizedPnlUsd: hit.unrealizedPnlUsd,
          daysHeld: hit.daysHeld,
          priceAsOfDate: hit.priceAsOfDate,
        };
      });
    }

    const donchianBatch = await fetchLatestStrategySignals(sb, "donchian_vwap");
    const heldTickers = new Set(bookOut.map((r) => r.ticker));
    const entryCandidates = donchianBatch.signals
      .filter((s) => s.side === "BUY" && !heldTickers.has(s.symbol))
      .map((s) => ({
        symbol: s.symbol,
        score: s.score,
        reason: s.reason,
        asOf: s.asOf,
        knownOn: s.knownOn,
      }));
    const exitHints = donchianBatch.signals
      .filter((s) => s.side === "SELL" && heldTickers.has(s.symbol))
      .map((s) => ({
        symbol: s.symbol,
        reason: s.reason,
        asOf: s.asOf,
        knownOn: s.knownOn,
      }));

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
      book: bookOut,
      orders: gateOrders(
        orders.map((o) => ({
          id: o.id,
          ticker: o.ticker,
          action: o.action,
          shares: o.shares,
          type: o.type,
          limitPrice: o.limit_price,
          reason: o.reason,
          sector: o.sector,
          riskUsd: o.risk_usd,
          createdAt: o.created_at?.slice(0, 10) ?? null,
        })),
        freshVerdict.signalsSuppressed
      ),
      harness: (() => {
        const cfg = harness.config ?? null;
        const maxNames = typeof cfg?.maxNames === "number" ? cfg.maxNames : 8;
        const maxPerSector = typeof cfg?.maxPerSector === "number" ? cfg.maxPerSector : 2;
        const stored = Array.isArray(harness.sectorExposure) ? harness.sectorExposure : [];
        const sectorExposure =
          stored.length > 0
            ? stored
            : sectorExposureFromBook(
                bookOut.map((r) => ({
                  sector: r.sector,
                  shares: r.shares,
                  last: r.last,
                })),
                latest.equity,
                maxNames,
                maxPerSector
              );
        return {
          sectorExposure,
          skipped: harness.skipped ?? [],
          config: cfg,
        };
      })(),
      log: Array.isArray(latest.log) ? latest.log : [],
      headline: staleHeadline(latest.headline, freshVerdict.signalsSuppressed),
      stale,
      signalsSuppressed: freshVerdict.signalsSuppressed,
      expectedEodDate: freshVerdict.expectedEodDate,
      priceAsOfDate,
      priceStaleDays,
      loopRunStaleDays: latest.asof_date ? tradingStaleDays(latest.asof_date.slice(0, 10)) : null,
      journal,
      journalSummary,
      strategy: {
        donchianVwap: {
          asOf: donchianBatch.asOf,
          knownOn: donchianBatch.knownOn,
          entryCandidates: freshVerdict.signalsSuppressed ? [] : entryCandidates,
          exitHints: freshVerdict.signalsSuppressed ? [] : exitHints,
        },
      },
    });
  } catch (err) {
    console.error("Loop API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
