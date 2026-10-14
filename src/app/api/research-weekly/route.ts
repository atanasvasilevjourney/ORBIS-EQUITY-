import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { evaluateFreshness } from "@/lib/freshness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunRow = {
  run_id: string;
  week_ending: string;
  headline: string | null;
  macro: unknown;
  sectors: unknown;
  risk_notes: unknown;
  computed_at: string | null;
};

type SetupRow = {
  run_id: string;
  rank: number;
  symbol: string;
  company_name: string | null;
  source: string | null;
  theme: string | null;
  side: string | null;
  entry_px: number | null;
  stop_px: number | null;
  target_px: number | null;
  rr: number | null;
  last_px: number | null;
  quality_rank: number | null;
  factor_score: number | null;
  rationale: string | null;
};

export async function GET() {
  try {
    const sb = createServerClient();
    const runs = await fetchAll<RunRow>(
      sb,
      "research_weekly_runs",
      "run_id, week_ending, headline, macro, sectors, risk_notes, computed_at",
      (q) => q.order("computed_at", { ascending: false })
    );
    const latest = runs[0] ?? null;
    if (!latest) {
      return NextResponse.json({
        summary: null,
        macro: null,
        sectors: [],
        riskNotes: [],
        setups: [],
        headline: null,
        stale: true,
      });
    }
    const setupsRaw = await fetchAll<SetupRow>(sb, "research_weekly_setups", "*");
    const setups = setupsRaw
      .filter((r) => r.run_id === latest.run_id)
      .sort((a, b) => a.rank - b.rank)
      .map((s) => ({
        rank: s.rank,
        ticker: s.symbol,
        companyName: s.company_name ?? "",
        source: s.source,
        theme: s.theme,
        side: s.side,
        entry: s.entry_px,
        stop: s.stop_px,
        target: s.target_px,
        rr: s.rr,
        last: s.last_px,
        qualityRank: s.quality_rank,
        factorScore: s.factor_score,
        rationale: s.rationale,
      }));
    const fresh = evaluateFreshness(latest.week_ending);
    return NextResponse.json({
      summary: {
        weekEnding: latest.week_ending,
        runId: latest.run_id,
        lastRunAt: latest.computed_at,
        setupCount: setups.length,
      },
      macro: latest.macro,
      sectors: Array.isArray(latest.sectors) ? latest.sectors : [],
      riskNotes: Array.isArray(latest.risk_notes) ? latest.risk_notes : [],
      setups,
      headline: latest.headline,
      stale: fresh.stale,
    });
  } catch (err) {
    console.error("Research weekly API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
