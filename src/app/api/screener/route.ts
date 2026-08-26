import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const revalidate = 900; // 15-minute cache — EOD data

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const direction = sp.get("direction"); // bull | bear | null (all)
  const region = sp.get("region");       // us | uk | eu | all
  const sector = sp.get("sector");
  const minRank = parseInt(sp.get("min_rank") ?? "0", 10);
  const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 1000);

  const sb = createServerClient();

  // Fetch trend_radar
  let query = sb
    .from("trend_radar")
    .select("symbol, state, quality_rank, z_mom, f_ewmac, z_52, breakout_active, volume_confirmed, kama_regime, adx, entry_timing, convergence_count, state_changed_at, computed_at", { count: "exact" })
    .gte("quality_rank", minRank)
    .order("quality_rank", { ascending: false })
    .limit(limit);

  if (direction === "bull") {
    query = query.eq("state", 1);
  } else if (direction === "bear") {
    query = query.eq("state", -1);
  }

  const [radarResult, universeResult, fundResult] = await Promise.all([
    query,
    sb.from("universe_members").select("symbol, company_name, sector, industry, country, exchange, tier").eq("is_active", true),
    sb.from("fundamentals_snapshot").select("symbol, price, market_cap, pe_ratio, dividend_yield"),
  ]);

  if (radarResult.error) {
    console.error("Supabase screener query error:", radarResult.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Build lookup maps
  const uniMap = new Map((universeResult.data ?? []).map((r: any) => [r.symbol, r]));
  const fundMap = new Map((fundResult.data ?? []).map((r: any) => [r.symbol, r]));

  // Filter and flatten
  let rows = (radarResult.data ?? []).map((r: any) => {
    const u = uniMap.get(r.symbol);
    const f = fundMap.get(r.symbol);
    if (!u) return null; // skip if not in universe
    return {
      symbol: r.symbol,
      companyName: u.company_name ?? "",
      sector: u.sector ?? "",
      country: u.country ?? "",
      exchange: u.exchange ?? "",
      tier: u.tier ?? "",
      state: r.state,
      rank: r.quality_rank,
      zMom: r.z_mom,
      fEwmac: r.f_ewmac,
      z52: r.z_52,
      breakout: r.breakout_active,
      volumeConfirmed: r.volume_confirmed,
      kamaRegime: r.kama_regime ?? 0,
      adx: r.adx ?? null,
      entryTiming: r.entry_timing ?? null,
      convergence: r.convergence_count,
      stateChangedAt: r.state_changed_at,
      price: f?.price ?? null,
      marketCap: f?.market_cap ?? null,
      peRatio: f?.pe_ratio ?? null,
      divYield: f?.dividend_yield ?? null,
    };
  }).filter(Boolean);

  // Post-filter by region/sector
  if (region && region !== "all") {
    const regionCountries: Record<string, string[]> = {
      us: ["US"],
      uk: ["GB"],
      eu: ["DE", "FR", "NL", "ES", "IT", "CH", "IE"],
    };
    const countries = regionCountries[region];
    if (countries) {
      rows = rows.filter((r: any) => countries.includes(r.country));
    }
  }

  if (sector) {
    rows = rows.filter((r: any) => r.sector === sector);
  }

  return NextResponse.json(rows);
}
