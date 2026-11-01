import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import {
  avgFinite,
  buildSectorFactorRows,
  buildStyleSummaries,
  type FactorRowScores,
} from "@/lib/factorInvesting";

export const revalidate = 900;

type FundRow = {
  symbol: string;
  value_score: number | null;
  quality_score: number | null;
  growth_score: number | null;
  earnings_quality_score: number | null;
  leverage_score: number | null;
  composite_factor_score: number | null;
  factor_computed_at: string | null;
};

type UniverseRow = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
};

function toScores(f: FundRow): FactorRowScores {
  return {
    symbol: f.symbol,
    valueScore: f.value_score,
    qualityScore: f.quality_score,
    growthScore: f.growth_score,
    earningsQualityScore: f.earnings_quality_score,
    leverageScore: f.leverage_score,
    compositeScore: f.composite_factor_score,
  };
}

export async function GET() {
  try {
    const sb = createServerClient();

    const [fundamentals, universe] = await Promise.all([
      fetchAll<FundRow>(
        sb,
        "fundamentals_snapshot",
        `
        symbol,
        value_score, quality_score, growth_score,
        earnings_quality_score, leverage_score,
        composite_factor_score, factor_computed_at
      `
      ),
      fetchAll<UniverseRow>(
        sb,
        "universe_members",
        "symbol, company_name, sector",
        (q) => q.eq("is_active", true)
      ),
    ]);

    const uniMap = new Map(universe.map((u) => [u.symbol, u]));
    const enriched = fundamentals
      .filter((f) => uniMap.has(f.symbol))
      .map((f) => {
        const u = uniMap.get(f.symbol)!;
        return {
          ...toScores(f),
          companyName: u.company_name ?? "",
          sector: u.sector ?? "",
          factorComputedAt: f.factor_computed_at,
        };
      });

    const withComposite = enriched.filter((r) => r.compositeScore != null);
    const factorComputedAt = enriched.reduce<string | null>((latest, row) => {
      const t = row.factorComputedAt;
      if (!t) return latest;
      if (!latest || t > latest) return t;
      return latest;
    }, null);

    const styles = buildStyleSummaries(enriched, 10);
    const sectors = buildSectorFactorRows(enriched);

    const topComposite = [...withComposite]
      .sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1))
      .slice(0, 25)
      .map(({ factorComputedAt: _fc, ...row }) => row);

    return NextResponse.json({
      summary: {
        universeNames: enriched.length,
        withComposite: withComposite.length,
        avgComposite: avgFinite(withComposite.map((r) => r.compositeScore)),
        highComposite70: withComposite.filter((r) => (r.compositeScore ?? 0) >= 70).length,
        factorComputedAt,
      },
      styles,
      sectors,
      topComposite,
    });
  } catch (err) {
    console.error("Factors API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
