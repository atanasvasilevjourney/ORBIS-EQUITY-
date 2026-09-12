import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

export const revalidate = 900; // 15-minute cache — EOD data

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

  // Check for query errors
  const queryError = [radarRes, fundRes, universeRes, earningsRes, insiderRes].find(
    (r) => r.error && r.error.code !== "PGRST116" // PGRST116 = "not found" for .single()
  );
  if (queryError?.error) {
    console.error("Supabase ticker query error:", queryError.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!universeRes.data) {
    return NextResponse.json({ error: "Ticker not found" }, { status: 404 });
  }

  return NextResponse.json({
    radar: radarRes.data,
    fundamentals: fundRes.data,
    universe: universeRes.data,
    earnings: earningsRes.data ?? [],
    insiderTrades: insiderRes.data ?? [],
  });
}