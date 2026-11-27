import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchTrendBandPullbacks, TREND_BAND_DISCLAIMER } from "@/lib/trendBandServer";
import { parseSymbolsQueryParam } from "@/lib/symbolsQuery";

export const revalidate = 900;
export const maxDuration = 60;

const DISCLAIMER =
  TREND_BAND_DISCLAIMER +
  " Heuristic only — not a trade signal. Nightly uses ema200_universe + supplements; live fallback is capped.";

export type { TrendBandApiRow } from "@/lib/trendBandServer";

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const flipOnly = req.nextUrl.searchParams.get("flip") === "1";
  const tfFilter = req.nextUrl.searchParams.get("timeframe");
  const assetFilter = req.nextUrl.searchParams.get("asset");
  const symbols = parseSymbolsQueryParam(req.nextUrl.searchParams.get("symbols"));

  try {
    const sb = createServerClient();
    const { asOfDate, headline, rows, dataSource } = await fetchTrendBandPullbacks(sb, {
      kind,
      flipOnly,
      timeframe: tfFilter,
      asset: assetFilter,
      symbols: symbols.length ? symbols : undefined,
    });

    return NextResponse.json({
      asOfDate,
      headline,
      names: rows.length,
      rows,
      dataSource,
      disclaimer: DISCLAIMER,
      band: {
        emaPeriod: 200,
        upper: "EMA200(high)",
        lower: "EMA200(low)",
        note: "Extends ema200_scanner math; weekly resampled from daily with ≥220 week warmup.",
      },
    });
  } catch (err) {
    console.error("[trend-band]", err);
    return NextResponse.json({ rows: [], disclaimer: DISCLAIMER, error: "fetch_failed" }, { status: 500 });
  }
}