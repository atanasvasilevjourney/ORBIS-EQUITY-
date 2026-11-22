import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { evaluateFreshness } from "@/lib/freshness";
import { bucketByHorizon, mapResearchIdea, type ResearchIdeaRow } from "@/lib/researchWeekly";

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
        ideas: [],
        horizons: { short_term: [], medium_term: [], long_term: [] },
        shorts: [],
        headline: null,
        stale: true,
      });
    }
    const setupsRaw = await fetchAll<ResearchIdeaRow>(sb, "research_weekly_setups", "*");
    const ideas = setupsRaw
      .filter((r) => r.run_id === latest.run_id)
      .sort((a, b) => a.rank - b.rank)
      .map(mapResearchIdea);
    const horizons = bucketByHorizon(ideas);
    const shorts = ideas.filter((i) => i.direction === "SHORT");
    const fresh = evaluateFreshness(latest.week_ending);
    return NextResponse.json({
      summary: {
        weekEnding: latest.week_ending,
        runId: latest.run_id,
        lastRunAt: latest.computed_at,
        setupCount: ideas.length,
        longCount: ideas.filter((i) => i.direction === "LONG").length,
        shortCount: shorts.length,
      },
      macro: latest.macro,
      sectors: Array.isArray(latest.sectors) ? latest.sectors : [],
      riskNotes: Array.isArray(latest.risk_notes) ? latest.risk_notes : [],
      setups: ideas,
      ideas,
      horizons,
      shorts,
      headline: latest.headline,
      stale: fresh.stale,
    });
  } catch (err) {
    console.error("Research weekly API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}