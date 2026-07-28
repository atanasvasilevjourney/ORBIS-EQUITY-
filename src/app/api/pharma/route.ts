import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const direction = sp.get("direction"); // LONG | SHORT | WATCH | null (all)
  const phase = sp.get("phase"); // PHASE2 | PHASE3 | null (all)
  const eventType = sp.get("event"); // TRIAL_FAILURE | RESULTS_POSTED | etc.
  const rawTicker = sp.get("ticker");
  const ticker = rawTicker && /^[A-Z0-9.\-]{1,20}$/i.test(rawTicker) ? rawTicker : null;
  if (rawTicker && !ticker) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 500);

  const sb = createServerClient();

  // Fetch signals with trial details
  let query = sb
    .from("pharma_signals")
    .select(`
      id,
      ticker,
      nct_id,
      event_type,
      direction,
      phase,
      confidence,
      days_to_catalyst,
      detected_at,
      pharma_trials (
        drug_name,
        condition,
        overall_status,
        lead_sponsor,
        start_date,
        completion_date,
        results_posted
      )
    `)
    .order("confidence", { ascending: false })
    .limit(limit);

  if (direction) {
    query = query.eq("direction", direction);
  }
  if (phase) {
    query = query.eq("phase", phase);
  }
  if (eventType) {
    query = query.eq("event_type", eventType);
  }
  if (ticker) {
    query = query.eq("ticker", ticker);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Supabase pharma query error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Flatten for frontend
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    ticker: r.ticker,
    nctId: r.nct_id,
    eventType: r.event_type,
    direction: r.direction,
    phase: r.phase,
    confidence: r.confidence,
    daysToCatalyst: r.days_to_catalyst,
    detectedAt: r.detected_at,
    drugName: r.pharma_trials?.drug_name ?? "",
    condition: r.pharma_trials?.condition ?? "",
    overallStatus: r.pharma_trials?.overall_status ?? "",
    leadSponsor: r.pharma_trials?.lead_sponsor ?? "",
    completionDate: r.pharma_trials?.completion_date ?? null,
    resultsPosted: r.pharma_trials?.results_posted ?? false,
  }));

  // Summary stats
  const totalLong = (data ?? []).filter((r: any) => r.direction === "LONG").length;
  const totalShort = (data ?? []).filter((r: any) => r.direction === "SHORT").length;
  const totalWatch = (data ?? []).filter((r: any) => r.direction === "WATCH").length;
  const upcoming = (data ?? []).filter(
    (r: any) => r.days_to_catalyst != null && r.days_to_catalyst >= 0 && r.days_to_catalyst <= 90
  ).length;

  return NextResponse.json({
    rows,
    summary: {
      total: rows.length,
      long: totalLong,
      short: totalShort,
      watch: totalWatch,
      upcoming90d: upcoming,
    },
  });
}
