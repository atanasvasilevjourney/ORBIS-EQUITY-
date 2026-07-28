import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const { ticker } = params;
  if (!/^[A-Z0-9.\-]{1,20}$/i.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker format" }, { status: 400 });
  }
  const sb = createServerClient();

  // Fetch all data for this ticker in parallel
  const [radarRes, fundRes, universeRes, earningsRes, insiderRes] = await Promise.all([
    sb.from("trend_radar").select("*").eq("symbol", ticker).single(),
    sb.from("fundamentals_snapshot").select("*").eq("symbol", ticker).single(),
    sb.from("universe_members").select("*").eq("symbol", ticker).single(),
    sb.from("earnings_calendar").select("*").eq("ticker", ticker).order("event_date", { ascending: false }).limit(8),
    sb.from("insider_trades_snapshot").select("*").eq("symbol", ticker).order("filing_date", { ascending: false }).limit(10),
  ]);

  return NextResponse.json({
    radar: radarRes.data,
    fundamentals: fundRes.data,
    universe: universeRes.data,
    earnings: earningsRes.data ?? [],
    insiderTrades: insiderRes.data ?? [],
  });
}
