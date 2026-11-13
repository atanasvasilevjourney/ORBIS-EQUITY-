import { NextRequest, NextResponse } from "next/server";
import { fetchYahooDaily } from "@/lib/yahooDaily";
import {
  TREND_ASSETS,
  buildDiagnostics,
  type PriceBar,
} from "@/lib/trendDiagnostics";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const DISCLAIMER =
  "State of trend across nine asset classes. Not a buy or sell signal. Forecasts are scaled so a typical reading is about ±10 and are capped at ±20. The blend needs several years of daily bars before it fills in.";

async function loadSeries(): Promise<{ series: Record<string, PriceBar[]>; missing: string[] }> {
  const series: Record<string, PriceBar[]> = {};
  const missing: string[] = [];
  await Promise.all(
    TREND_ASSETS.map(async (asset) => {
      const bars = await fetchYahooDaily(asset.symbol, "max");
      if (bars.length < 2) {
        missing.push(asset.symbol);
        series[asset.symbol] = [];
        return;
      }
      series[asset.symbol] = bars.map((b) => ({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
    })
  );
  return { series, missing };
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") === "relative" ? "relative" : "absolute";
  const focus = req.nextUrl.searchParams.get("focus");
  try {
    const { series, missing } = await loadSeries();
    const desk = buildDiagnostics({ series, mode, focus });
    return NextResponse.json({
      ...desk,
      disclaimer: DISCLAIMER,
      missing,
      source: "Yahoo Finance daily, adjusted",
    });
  } catch (err) {
    console.error("Trend diagnostics error:", err);
    const desk = buildDiagnostics({ series: {}, mode, focus });
    return NextResponse.json({
      ...desk,
      disclaimer: DISCLAIMER,
      missing: TREND_ASSETS.map((a) => a.symbol),
      source: "unavailable",
    });
  }
}
