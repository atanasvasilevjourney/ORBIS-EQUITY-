import { NextResponse } from "next/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { createServerClient } from "@/lib/supabase/server";
import { screenClose } from "@/lib/temaScreen";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type FundRow = { symbol: string; market_cap: number | null };
type NameRow = { symbol: string; company_name: string | null; sector: string | null };
type PriceRow = { symbol: string; date: string; close: number | null };

function companyKey(name: string | null, symbol: string): string {
  const text = (name || symbol).toLowerCase().split(" - ")[0].split(" class ")[0];
  return text.replace(/\s+/g, " ").trim();
}

function rankSymbols(funds: FundRow[], names: Map<string, NameRow>, n = 100): string[] {
  const best = new Map<string, { cap: number; symbol: string }>();
  for (const row of funds) {
    const cap = Number(row.market_cap);
    if (!row.symbol || !Number.isFinite(cap) || cap <= 0) continue;
    const meta = names.get(row.symbol);
    const key = companyKey(meta?.company_name ?? null, row.symbol);
    const held = best.get(key);
    if (!held || cap > held.cap) best.set(key, { cap, symbol: row.symbol });
  }
  return Array.from(best.values())
    .sort((a, b) => b.cap - a.cap)
    .slice(0, n)
    .map((row) => row.symbol);
}

async function fetchPrices(symbols: string[]): Promise<PriceRow[]> {
  const sb = createServerClient();
  const rows: PriceRow[] = [];
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    const page = await fetchAll<PriceRow>(
      sb,
      "prices_daily",
      "symbol, date, close",
      (q) => q.in("symbol", chunk).order("symbol", { ascending: true }).order("date", { ascending: true })
    );
    rows.push(...page);
  }
  return rows;
}

export async function GET() {
  try {
    const sb = createServerClient();
    const [funds, universe] = await Promise.all([
      fetchAll<FundRow>(sb, "fundamentals_snapshot", "symbol, market_cap", (q) =>
        q.order("market_cap", { ascending: false })
      ),
      fetchAll<NameRow>(sb, "universe_members", "symbol, company_name, sector", (q) =>
        q.order("symbol", { ascending: true })
      ),
    ]);
    const bySymbol = new Map<string, NameRow>();
    for (const row of universe) {
      if (!row.symbol) continue;
      const prev = bySymbol.get(row.symbol);
      bySymbol.set(row.symbol, {
        symbol: row.symbol,
        company_name: row.company_name || prev?.company_name || null,
        sector: row.sector || prev?.sector || null,
      });
    }
    const symbols = rankSymbols(funds, bySymbol);
    const prices = await fetchPrices(symbols);
    const byClose = new Map<string, { date: string; close: number }[]>();
    for (const row of prices) {
      const close = Number(row.close);
      if (!row.symbol || !Number.isFinite(close) || close <= 0) continue;
      const list = byClose.get(row.symbol) ?? [];
      list.push({ date: row.date, close });
      byClose.set(row.symbol, list);
    }

    const screened = symbols.flatMap((symbol) => {
      const bars = (byClose.get(symbol) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      const state = screenClose(bars.map((bar) => bar.close));
      if (!state) return [];
      const meta = bySymbol.get(symbol);
      return [
        {
          ticker: symbol,
          companyName: meta?.company_name ?? "",
          sector: meta?.sector ?? "",
          last: bars[bars.length - 1]?.close ?? null,
          asOf: bars[bars.length - 1]?.date ?? null,
          on: state.on,
          votes: state.votes,
          distance: state.distance,
          histograms: state.histograms,
        },
      ];
    });
    const on = screened
      .filter((row) => row.on)
      .sort((a, b) => b.votes - a.votes || b.distance - a.distance || a.ticker.localeCompare(b.ticker));

    return NextResponse.json({
      watched: symbols.length,
      on: on.length,
      rows: on,
    });
  } catch (err) {
    console.error("TEMA screen error:", err);
    return NextResponse.json({ watched: 0, on: 0, rows: [], headline: "TEMA screen unavailable" });
  }
}
