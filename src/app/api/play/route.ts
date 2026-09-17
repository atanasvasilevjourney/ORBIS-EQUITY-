import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import {
  rankGainers,
  rankGappers,
  rankLiquid,
  rankLosers,
  sessionMovers,
  type SessionBar,
} from "@/lib/sessionMovers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PxRow = {
  symbol: string;
  date: string;
  open: number | string | null;
  high: number | string | null;
  low: number | string | null;
  close: number | string | null;
  volume: number | string | null;
};

type UniRow = { symbol: string; company_name: string | null };

const EMPTY = {
  summary: null,
  gainers: [] as ReturnType<typeof rankGainers>,
  losers: [] as ReturnType<typeof rankLosers>,
  gappers: [] as ReturnType<typeof rankGappers>,
  liquid: [] as ReturnType<typeof rankLiquid>,
  headline: null as string | null,
  stale: true,
};

function asBar(r: PxRow): SessionBar | null {
  const close = Number(r.close);
  const open = Number(r.open ?? r.close);
  const high = Number(r.high ?? r.close);
  const low = Number(r.low ?? r.close);
  if (!r.symbol || ![close, open, high, low].every((v) => Number.isFinite(v))) return null;
  return {
    symbol: r.symbol,
    date: String(r.date).slice(0, 10),
    open,
    high,
    low,
    close,
    volume: r.volume == null ? null : Number(r.volume),
  };
}

async function latestTwoDates(sb: ReturnType<typeof createServerClient>): Promise<[string, string] | null> {
  const last = await sb.from("prices_daily").select("date").order("date", { ascending: false }).limit(1);
  const lastDate = last.data?.[0]?.date ? String(last.data[0].date).slice(0, 10) : null;
  if (!lastDate) return null;
  const prev = await sb
    .from("prices_daily")
    .select("date")
    .lt("date", lastDate)
    .order("date", { ascending: false })
    .limit(1);
  const prevDate = prev.data?.[0]?.date ? String(prev.data[0].date).slice(0, 10) : null;
  if (!prevDate) return null;
  return [lastDate, prevDate];
}

export async function GET() {
  try {
    const sb = createServerClient();
    const dates = await latestTwoDates(sb);
    if (!dates) return NextResponse.json(EMPTY);
    const [asOf, prior] = dates;
    const [todayRows, prevRows, uni] = await Promise.all([
      fetchAll<PxRow>(sb, "prices_daily", "symbol, date, open, high, low, close, volume", (q) => q.eq("date", asOf)),
      fetchAll<PxRow>(sb, "prices_daily", "symbol, date, open, high, low, close, volume", (q) => q.eq("date", prior)),
      fetchAll<UniRow>(sb, "universe_members", "symbol, company_name", (q) => q.eq("is_active", true)).catch(() => []),
    ]);
    const names: Record<string, string> = {};
    for (const u of uni) {
      if (u.symbol) names[u.symbol] = u.company_name ?? "";
    }
    const today = todayRows.map(asBar).filter((r): r is SessionBar => r != null);
    const prev = prevRows.map(asBar).filter((r): r is SessionBar => r != null);
    const book = sessionMovers(today, prev, names);
    const gainers = rankGainers(book);
    const losers = rankLosers(book);
    const gappers = rankGappers(book);
    const liquid = rankLiquid(book);
    const stale = (Date.now() - new Date(asOf).getTime()) / 86400000 > 3;
    const top = gainers[0];
    const headline = top
      ? `${asOf} · ${book.length} names · ${gainers.length} up · lead ${top.ticker} ${(top.chgPct * 100).toFixed(1)}%`
      : `${asOf} · no session movers`;
    return NextResponse.json({
      summary: {
        asOfDate: asOf,
        priorDate: prior,
        names: book.length,
        nGainers: gainers.length,
        nLosers: losers.length,
        nGappers: gappers.length,
      },
      gainers,
      losers,
      gappers,
      liquid,
      headline,
      stale,
    });
  } catch (err) {
    console.error("Play API error:", err);
    return NextResponse.json({ ...EMPTY, headline: "Play desk unavailable" });
  }
}
