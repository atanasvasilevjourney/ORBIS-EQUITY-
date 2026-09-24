import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { lastTradingSessionDate } from "@/lib/cashSession";
import { quoteIsFresh } from "@/lib/lseLive";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunLite = { asof_date?: string | null; computed_at?: string | null; names?: number | null; headline?: string | null };

function bookStale(asOf: string | null | undefined, expected: string): boolean {
  if (!asOf) return true;
  if (asOf < expected) return true;
  return (Date.now() - new Date(asOf).getTime()) / 86400000 > 3;
}

async function latestRun(sb: ReturnType<typeof createServerClient>, table: string): Promise<RunLite | null> {
  const { data } = await sb
    .from(table)
    .select("asof_date, computed_at, names, headline")
    .order("computed_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

export async function GET() {
  try {
    const sb = createServerClient();
    const expected = lastTradingSessionDate();
    const [cash, quant, rotate, lastPx, quotes] = await Promise.all([
      latestRun(sb, "perp_runs"),
      latestRun(sb, "quantropy_runs"),
      latestRun(sb, "sector_rotation_runs"),
      sb.from("prices_daily").select("date").order("date", { ascending: false }).limit(1),
      sb
        .from("quotes_last")
        .select("symbol, ts, replay, updated_at")
        .order("updated_at", { ascending: false })
        .limit(40),
    ]);
    const priceAsOf = lastPx.data?.[0]?.date ? String(lastPx.data[0].date).slice(0, 10) : null;
    const quoteRows = (quotes && "data" in quotes ? quotes.data : quotes) ?? [];
    const live = Array.isArray(quoteRows)
      ? quoteRows.filter((q) => quoteIsFresh((q as { updated_at?: string }).updated_at) && !(q as { replay?: boolean }).replay)
      : [];
    return NextResponse.json({
      expectedLastClose: expected,
      priceAsOf,
      cash: {
        asOfDate: cash?.asof_date ?? null,
        stale: bookStale(cash?.asof_date, expected),
        lite: !cash,
        names: cash?.names ?? 0,
        headline: cash?.headline ?? null,
      },
      quant: {
        asOfDate: quant?.asof_date ?? null,
        stale: bookStale(quant?.asof_date, expected),
        lite: !quant,
        names: quant?.names ?? 0,
        headline: quant?.headline ?? null,
      },
      rotate: {
        asOfDate: rotate?.asof_date ?? null,
        stale: bookStale(rotate?.asof_date, expected),
        lite: !rotate,
        names: rotate?.names ?? 0,
        headline: rotate?.headline ?? null,
      },
      play: {
        asOfDate: priceAsOf,
        stale: bookStale(priceAsOf, expected),
        lite: false,
        streaming: live.length > 0,
        names: live.length,
      },
    });
  } catch (err) {
    console.error("Desks API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
