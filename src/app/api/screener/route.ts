import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const REGION_COUNTRIES: Record<string, string[]> = {
  us: ["US"],
  uk: ["GB"],
  eu: ["DE", "FR", "NL", "ES", "IT", "CH", "IE"],
};

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const direction = sp.get("direction");
    const region = sp.get("region");
    const sector = sp.get("sector");
    const minRank = parseInt(sp.get("min_rank") ?? "0", 10);
    const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 1000);
    const wrap = sp.get("meta") === "1" || sp.get("format") === "meta";

    if (Number.isNaN(minRank)) {
      return NextResponse.json({ error: "Invalid min_rank" }, { status: 400 });
    }

    const sb = createServerClient();

    type UniverseRow = { symbol: string; company_name: string | null; sector: string | null; industry: string | null; country: string | null; exchange: string | null; tier: string | null };
    type FundRow = { symbol: string; price: number | null; market_cap: number | null; pe_ratio: number | null; dividend_yield: number | null };
    type RadarRow = { symbol: string; state: number; quality_rank: number; z_mom: number; f_ewmac: number; z_52: number; breakout_active: boolean; volume_confirmed: boolean; convergence_count: number; state_changed_at: string | null; computed_at: string | null };
    type PxRow = { symbol: string; close: number | null };

    const [universe, fundamentals, lastBar] = await Promise.all([
      fetchAll<UniverseRow>(sb, "universe_members", "symbol, company_name, sector, industry, country, exchange, tier", (q) =>
        q.eq("is_active", true)
      ),
      fetchAll<FundRow>(sb, "fundamentals_snapshot", "symbol, price, market_cap, pe_ratio, dividend_yield"),
      sb.from("prices_daily").select("date, source").order("date", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const tapeDate = (lastBar.data?.date as string | undefined) ?? null;
    const tapeSource = (lastBar.data?.source as string | undefined) ?? null;
    const cashCloses = tapeDate
      ? await fetchAll<PxRow>(sb, "prices_daily", "symbol, close", (q) => q.eq("date", tapeDate))
      : [];
    const closeOf = new Map(cashCloses.map((p) => [p.symbol, p.close]));

    let filteredUniverse = universe;
    if (region && region !== "all") {
      const countries = REGION_COUNTRIES[region];
      if (countries) {
        filteredUniverse = filteredUniverse.filter((u) => countries.includes(u.country ?? ""));
      }
    }
    if (sector) {
      filteredUniverse = filteredUniverse.filter((u) => u.sector === sector);
    }

    const allowedSymbols = new Set(filteredUniverse.map((u) => u.symbol));

    const allRadar: RadarRow[] = await fetchAll<RadarRow>(
      sb,
      "trend_radar",
      "symbol, state, quality_rank, z_mom, f_ewmac, z_52, breakout_active, volume_confirmed, convergence_count, state_changed_at, computed_at",
      (q) => {
        let query = q.order("quality_rank", { ascending: false });
        if (direction === "bull") query = query.eq("state", 1);
        else if (direction === "bear") query = query.eq("state", -1);
        return query;
      }
    );

    const ranks = allRadar.map((r) => r.quality_rank).filter((n) => n != null);
    const maxRank = ranks.length ? Math.max(...ranks) : 0;
    const ranked = minRank > 0 ? allRadar.filter((r) => (r.quality_rank ?? 0) >= minRank) : allRadar;

    const rows = ranked
      .filter((r) => allowedSymbols.has(r.symbol))
      .slice(0, limit)
      .map((r) => {
        const u = filteredUniverse.find((x) => x.symbol === r.symbol);
        const f = fundamentals.find((x) => x.symbol === r.symbol);
        if (!u) return null;
        const cash = closeOf.get(r.symbol);
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
          convergence: r.convergence_count,
          stateChangedAt: r.state_changed_at,
          price: cash ?? f?.price ?? null,
          marketCap: f?.market_cap ?? null,
          peRatio: f?.pe_ratio ?? null,
          divYield: f?.dividend_yield ?? null,
        };
      })
      .filter(Boolean);

    const meta = {
      returned: rows.length,
      radar: allRadar.length,
      universe: universe.length,
      maxRank,
      lastClose: tapeDate,
      source: tapeSource,
      filters: { direction: direction ?? "all", region: region ?? "all", sector: sector ?? null, minRank },
      streaming: { lse: false, yahooEod: true },
    };

    // Default stays a raw array so older clients keep working.
    if (!wrap) return NextResponse.json(rows);
    return NextResponse.json({ rows, meta });
  } catch (err) {
    console.error("Screener API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
