import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { evaluateFreshness } from "@/lib/freshness";
import { staleHeadline } from "@/lib/signalGate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PackRow = {
  pack_id: string;
  week_start: string;
  asof_date: string;
  headline: string | null;
  macro: unknown;
  internals: unknown;
  sector_rotation: unknown;
  risk_notes: unknown;
  config_version: number | null;
  computed_at: string | null;
};

type SetupRow = {
  pack_id: string;
  rank: number;
  symbol: string;
  company_name: string | null;
  theme_bucket: string | null;
  desk_source: string | null;
  side: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  orbis_score: number | null;
  status: string | null;
  rationale: string | null;
  rules: unknown;
};

function mapSetup(r: SetupRow) {
  return {
    rank: r.rank,
    ticker: r.symbol,
    companyName: r.company_name ?? "",
    themeBucket: r.theme_bucket,
    deskSource: r.desk_source,
    side: r.side,
    entry: r.entry,
    stop: r.stop,
    target: r.target,
    rr: r.rr,
    orbisScore: r.orbis_score,
    status: r.status ?? "pending",
    rationale: r.rationale,
    rules: r.rules,
  };
}

export async function GET() {
  try {
    const sb = createServerClient();
    const packs = await fetchAll<PackRow>(
      sb,
      "research_weekly_pack",
      "pack_id, week_start, asof_date, headline, macro, internals, sector_rotation, risk_notes, config_version, computed_at",
      (q) => q.order("week_start", { ascending: false })
    );
    const latest = packs[0] ?? null;
    if (!latest) {
      return NextResponse.json({
        summary: null,
        macro: [],
        internals: null,
        sectorRotation: null,
        riskNotes: null,
        setups: [],
        headline: null,
        stale: true,
      });
    }

    const setups = await fetchAll<SetupRow>(
      sb,
      "research_setups",
      "pack_id, rank, symbol, company_name, theme_bucket, desk_source, side, entry, stop, target, rr, orbis_score, status, rationale, rules",
      (q) => q.eq("pack_id", latest.pack_id).order("rank", { ascending: true })
    );

    const fresh = evaluateFreshness(latest.asof_date);
    const stale = fresh.stale;

    return NextResponse.json({
      summary: {
        packId: latest.pack_id,
        weekStart: latest.week_start,
        asOfDate: latest.asof_date,
        configVersion: latest.config_version,
        lastRunAt: latest.computed_at,
      },
      macro: Array.isArray(latest.macro) ? latest.macro : [],
      internals: latest.internals ?? null,
      sectorRotation: latest.sector_rotation ?? null,
      riskNotes: latest.risk_notes ?? null,
      setups: setups.map(mapSetup),
      headline: staleHeadline(latest.headline, fresh.signalsSuppressed),
      stale,
      signalsSuppressed: fresh.signalsSuppressed,
    });
  } catch (err) {
    console.error("Research weekly API error:", err);
    return NextResponse.json({
      summary: null,
      macro: [],
      internals: null,
      sectorRotation: null,
      riskNotes: null,
      setups: [],
      headline: null,
      stale: true,
    });
  }
}
