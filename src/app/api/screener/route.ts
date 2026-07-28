import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const direction = sp.get("direction"); // bull | bear | null (all)
  const region = sp.get("region");       // us | uk | eu | all
  const sector = sp.get("sector");
  const minRank = parseInt(sp.get("min_rank") ?? "0", 10);
  const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 1000);

  const sb = createServerClient();

  // Join trend_radar with universe_members
  let query = sb
    .from("trend_radar")
    .select(`
      symbol,
      state,
      quality_rank,
      z_mom,
      f_ewmac,
      z_52,
      breakout_active,
      volume_confirmed,
      convergence_count,
      state_changed_at,
      computed_at,
      universe_members!inner (
        company_name,
        sector,
        industry,
        country,
        exchange,
        tier
      ),
      fundamentals_snapshot (
        price,
        market_cap,
        pe_ratio,
        dividend_yield
      )
    `)
    .gte("quality_rank", minRank)
    .order("quality_rank", { ascending: false })
    .limit(limit);

  // Direction filter
  if (direction === "bull") {
    query = query.eq("state", 1);
  } else if (direction === "bear") {
    query = query.eq("state", -1);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Post-filter by region/sector (joined fields)
  let filtered = data ?? [];

  if (region && region !== "all") {
    const regionCountries: Record<string, string[]> = {
      us: ["US"],
      uk: ["GB"],
      eu: ["DE", "FR", "NL", "ES", "IT", "CH", "IE"],
    };
    const countries = regionCountries[region];
    if (countries) {
      filtered = filtered.filter((r: any) =>
        countries.includes(r.universe_members?.country)
      );
    }
  }

  if (sector) {
    filtered = filtered.filter(
      (r: any) => r.universe_members?.sector === sector
    );
  }

  // Flatten for frontend consumption
  const rows = filtered.map((r: any) => ({
    symbol: r.symbol,
    companyName: r.universe_members?.company_name ?? "",
    sector: r.universe_members?.sector ?? "",
    country: r.universe_members?.country ?? "",
    exchange: r.universe_members?.exchange ?? "",
    tier: r.universe_members?.tier ?? "",
    state: r.state,
    rank: r.quality_rank,
    zMom: r.z_mom,
    fEwmac: r.f_ewmac,
    z52: r.z_52,
    breakout: r.breakout_active,
    volumeConfirmed: r.volume_confirmed,
    convergence: r.convergence_count,
    stateChangedAt: r.state_changed_at,
    price: r.fundamentals_snapshot?.price ?? null,
    marketCap: r.fundamentals_snapshot?.market_cap ?? null,
    peRatio: r.fundamentals_snapshot?.pe_ratio ?? null,
    divYield: r.fundamentals_snapshot?.dividend_yield ?? null,
  }));

  return NextResponse.json(rows);
}
