import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { evaluateFreshness } from "@/lib/freshness";
import { gateSide, staleHeadline } from "@/lib/signalGate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunRow = {
  run_id: string;
  asof_date: string;
  names: number | null;
  longs: number | null;
  shorts: number | null;
  headline: string | null;
  computed_at: string | null;
};

type NameRow = {
  symbol: string;
  run_id: string | null;
  company_name: string | null;
  last_px: number | null;
  bias: string | null;
  confidence: string | null;
  vote: string | null;
  buy_count: number | null;
  sell_count: number | null;
  atr: number | null;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  range_lo: number | null;
  range_hi: number | null;
  levels: unknown;
  ideas: unknown;
  scenarios: unknown;
  rationale: string | null;
};

function mapBiasName(r: NameRow) {
  return {
    ticker: r.symbol,
    companyName: r.company_name ?? "",
    last: r.last_px,
    bias: r.bias,
    confidence: r.confidence,
    vote: r.vote,
    buyCount: r.buy_count,
    sellCount: r.sell_count,
    atr: r.atr,
    rsi: r.rsi,
    sma20: r.sma20,
    sma50: r.sma50,
    rangeLo: r.range_lo,
    rangeHi: r.range_hi,
    levels: Array.isArray(r.levels) ? r.levels : [],
    ideas: Array.isArray(r.ideas) ? r.ideas : [],
    scenarios: Array.isArray(r.scenarios) ? r.scenarios : [],
    rationale: r.rationale,
  };
}

export async function GET() {
  try {
    const sb = createServerClient();
    const runs = await fetchAll<RunRow>(
      sb,
      "bias_runs",
      "run_id, asof_date, names, longs, shorts, headline, computed_at",
      (q) => q.order("computed_at", { ascending: false })
    );
    const latest = runs[0] ?? null;
    if (!latest) {
      return NextResponse.json({ summary: null, names: [], headline: null, stale: true });
    }
    const rows = await fetchAll<NameRow>(sb, "bias_names", "*");
    const names = rows
      .filter((r) => r.run_id === latest.run_id)
      .map(mapBiasName)
      .sort((a, b) => {
        const rank = (x: string | null) => (x === "LONG" ? 0 : x === "SHORT" ? 1 : 2);
        const d = rank(a.bias) - rank(b.bias);
        if (d !== 0) return d;
        return (a.ticker || "").localeCompare(b.ticker || "");
      });
    const fresh = evaluateFreshness(latest.asof_date);
    const suppress = fresh.signalsSuppressed;
    const gatedNames = suppress
      ? names.map((n) => ({
          ...n,
          bias: gateSide(n.bias, true) ?? "NEUTRAL",
          ideas: [],
        }))
      : names;
    return NextResponse.json({
      summary: {
        names: latest.names,
        longs: suppress ? 0 : latest.longs,
        shorts: suppress ? 0 : latest.shorts,
        asOfDate: latest.asof_date,
        runId: latest.run_id,
        lastRunAt: latest.computed_at,
      },
      names: gatedNames,
      headline: staleHeadline(latest.headline, suppress),
      stale: fresh.stale,
      signalsSuppressed: suppress,
    });
  } catch (err) {
    console.error("Bias API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
