import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { cashClock } from "@/lib/cashSession";
import { overnightFromSpark, rankOvernightUps } from "@/lib/overnightGaps";
import {
  rankGainers,
  rankGappers,
  rankLiquid,
  rankLosers,
  sessionMovers,
  type SessionBar,
} from "@/lib/sessionMovers";
import {
  BREAKOUT_MIN_PRICE,
  BREAKOUT_MIN_VOLUME,
  dailyCloseBreakouts,
  rankBreakouts,
  sparkCloseBreakouts,
  type BreakoutHit,
} from "@/lib/breakoutScan";
import { fetchYahooSpark } from "@/lib/yahooSpark";

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
  overnight: [] as ReturnType<typeof rankOvernightUps>,
  breakouts: [] as BreakoutHit[],
  breakouts5m: [] as BreakoutHit[],
  clock: cashClock(),
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

function histFrom(asOf: string, days = 220): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function histForSymbols(
  sb: ReturnType<typeof createServerClient>,
  symbols: string[],
  asOf: string
): Promise<PxRow[]> {
  if (!symbols.length) return [];
  const from = histFrom(asOf);
  const cols = "symbol, date, open, high, low, close, volume";
  const out: PxRow[] = [];
  const CHUNK = 40;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    const rows = await fetchAll<PxRow>(sb, "prices_daily", cols, (q) =>
      q.in("symbol", chunk).gte("date", from).lte("date", asOf)
    );
    for (let j = 0; j < rows.length; j++) out.push(rows[j]);
  }
  return out;
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
    const clock = cashClock();
    let overnight: ReturnType<typeof rankOvernightUps> = [];
    let breakouts5m: BreakoutHit[] = [];
    const candidates = today
      .filter((b) => b.close >= BREAKOUT_MIN_PRICE && (b.volume ?? 0) >= BREAKOUT_MIN_VOLUME)
      .map((b) => b.symbol);
    const histRows = await histForSymbols(sb, candidates, asOf).catch(() => [] as PxRow[]);
    const histBars = histRows
      .map((r) => {
        const b = asBar(r);
        if (!b) return null;
        return { ...b, volume: b.volume };
      })
      .filter((r): r is { symbol: string; date: string; open: number; high: number; low: number; close: number; volume: number | null } => r != null);
    const breakouts = rankBreakouts(dailyCloseBreakouts(histBars, names), "volume");
    try {
      const sparkSyms = Object.keys(names);
      if (sparkSyms.length === 0) {
        for (let i = 0; i < book.length; i++) sparkSyms.push(book[i].ticker);
      }
      const spark = await fetchYahooSpark(sparkSyms.slice(0, 80), "1d");
      overnight = rankOvernightUps(overnightFromSpark(spark, names));
      const fiveSyms: string[] = [];
      const seen = new Set<string>();
      const add = (t: string) => {
        if (seen.has(t)) return;
        seen.add(t);
        fiveSyms.push(t);
      };
      for (let i = 0; i < overnight.length && fiveSyms.length < 12; i++) add(overnight[i].ticker);
      for (let i = 0; i < breakouts.length && fiveSyms.length < 20; i++) add(breakouts[i].ticker);
      for (let i = 0; i < liquid.length && fiveSyms.length < 24; i++) add(liquid[i].ticker);
      if (fiveSyms.length) {
        const spark5 = await fetchYahooSpark(fiveSyms, "5d");
        const dailyVol: Record<string, number | null> = {};
        for (let i = 0; i < book.length; i++) dailyVol[book[i].ticker] = book[i].volume;
        breakouts5m = rankBreakouts(sparkCloseBreakouts(spark5, names, dailyVol), "volume");
      }
    } catch (err) {
      console.warn("overnight spark failed", err);
    }
    const stale = (Date.now() - new Date(asOf).getTime()) / 86400000 > 3;
    const sessionLead = gainers[0];
    const overnightLead = overnight[0];
    const bits = [`${asOf} · ${book.length} names · ${gainers.length} up`];
    if (sessionLead) bits.push(`session ${sessionLead.ticker} ${(sessionLead.chgPct * 100).toFixed(1)}%`);
    if (overnightLead) {
      bits.push(
        `${clock.phase} ${overnightLead.ticker} ${(overnightLead.gapPct * 100).toFixed(1)}% · Yahoo delayed`
      );
    }
    if (breakouts[0]) bits.push(`brk ${breakouts[0].ticker} HH${breakouts[0].lookback}`);
    bits.push(clock.et);
    const headline = bits.join(" · ");
    return NextResponse.json({
      summary: {
        asOfDate: asOf,
        priorDate: prior,
        names: book.length,
        nGainers: gainers.length,
        nLosers: losers.length,
        nGappers: gappers.length,
        nOvernight: overnight.length,
        overnightLead: overnight[0]?.ticker ?? null,
        overnightLeadGap: overnight[0]?.gapPct ?? null,
        nBreakouts: breakouts.length,
        nBreakouts5m: breakouts5m.length,
      },
      gainers,
      losers,
      gappers,
      liquid,
      overnight,
      breakouts,
      breakouts5m,
      clock,
      headline,
      stale,
    });
  } catch (err) {
    console.error("Play API error:", err);
    return NextResponse.json({ ...EMPTY, headline: "Play desk unavailable" });
  }
}
