import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { isMissingRelation } from "@/lib/supabase/errors";
import { fetchYahooDaily } from "@/lib/yahooDaily";
import {
  detectTrianglesFromCandles,
  triangleGeometryToChart,
  type TriangleHit,
  TRIANGLE_DEFAULTS,
} from "@/lib/trianglePattern";
import type { Candle } from "@/components/chart/TradingChart";

export const revalidate = 900;
export const maxDuration = 60;

type DbRow = {
  symbol: string;
  bar_date: string;
  pattern_type: string;
  status: string;
  score: number | null;
  close: number | null;
  support_price: number | null;
  resistance_price: number | null;
  geometry: Record<string, unknown> | null;
};

export type TriangleApiRow = {
  symbol: string;
  barDate: string;
  patternType: "ascending" | "descending";
  status: string;
  score: number | null;
  close: number | null;
  supportPrice: number | null;
  resistancePrice: number | null;
  geometry: TriangleHit["geometry"] | null;
  companyName: string;
};

function mapRow(r: DbRow, names: Map<string, string>): TriangleApiRow {
  return {
    symbol: r.symbol,
    barDate: r.bar_date,
    patternType: r.pattern_type as "ascending" | "descending",
    status: r.status,
    score: r.score,
    close: r.close,
    supportPrice: r.support_price,
    resistancePrice: r.resistance_price,
    geometry: (r.geometry as TriangleHit["geometry"]) ?? null,
    companyName: names.get(r.symbol) ?? r.symbol,
  };
}

async function liveScanSample(symbols: string[], limit: number): Promise<TriangleApiRow[]> {
  const out: TriangleApiRow[] = [];
  for (const sym of symbols.slice(0, limit)) {
    const bars = await fetchYahooDaily(sym, "2y");
    if (bars.length < TRIANGLE_DEFAULTS.lookbackBars) continue;
    const candles: Candle[] = bars.map((b) => ({
      time: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    for (const hit of detectTrianglesFromCandles(candles)) {
      if (hit.status === "forming" && hit.score < 50) continue;
      out.push({
        symbol: sym,
        barDate: String(bars[bars.length - 1]?.date ?? "").slice(0, 10),
        patternType: hit.patternType,
        status: hit.status,
        score: hit.score,
        close: hit.close,
        supportPrice: hit.supportPrice,
        resistancePrice: hit.resistancePrice,
        geometry: hit.geometry,
        companyName: sym,
      });
    }
  }
  out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return out;
}

export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get("filter") ?? "breakout";
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const pattern = req.nextUrl.searchParams.get("pattern") as "ascending" | "descending" | null;

  try {
    const sb = createServerClient();
    let rows: DbRow[] = [];
    let run: { asof_date: string; headline: string | null; names: number | null } | null = null;

    try {
      const runs = await fetchAll<{ asof_date: string; headline: string | null; names: number | null }>(
        sb,
        "triangle_scan_runs",
        "asof_date, headline, names"
      );
      run = runs.sort((a, b) => b.asof_date.localeCompare(a.asof_date))[0] ?? null;
      const barDate = run?.asof_date;
      if (barDate) {
        rows = await fetchAll<DbRow>(
          sb,
          "triangle_setups",
          "symbol, bar_date, pattern_type, status, score, close, support_price, resistance_price, geometry",
          (q) => q.eq("bar_date", barDate)
        );
      }
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }

    const uni = await fetchAll<{ symbol: string; company_name: string | null }>(
      sb,
      "universe_members",
      "symbol, company_name"
    );
    const names = new Map(uni.map((u) => [u.symbol, u.company_name ?? u.symbol]));

    let mapped = rows.map((r) => mapRow(r, names));

    if (!mapped.length) {
      const syms = uni.map((u) => u.symbol).filter(Boolean);
      mapped = await liveScanSample(syms, 35);
    }

    if (pattern) mapped = mapped.filter((r) => r.patternType === pattern);
    if (filter === "breakout") {
      mapped = mapped.filter((r) => r.status === "breakout_up" || r.status === "breakout_down");
    } else if (filter === "forming") {
      mapped = mapped.filter((r) => r.status === "forming");
    }

    mapped.sort((a, b) => {
      const bo = (s: string) => (s.startsWith("breakout") ? 1 : 0);
      return bo(b.status) - bo(a.status) || (b.score ?? 0) - (a.score ?? 0);
    });

    if (symbol) {
      const row = mapped.find((r) => r.symbol === symbol);
      const overlay = row
        ? triangleGeometryToChart(row.geometry, row.patternType)
        : { segments: [], levels: [] };
      return NextResponse.json({ symbol, row: row ?? null, overlay });
    }

    return NextResponse.json({
      asOfDate: run?.asof_date ?? mapped[0]?.barDate ?? null,
      headline: run?.headline ?? "Live triangle scan (apply migration 029 for nightly persistence)",
      names: mapped.length,
      filter,
      rows: mapped,
      dataSource: rows.length ? "triangle_setups" : "live_yahoo",
      disclaimer:
        "Pattern math mirrors pillai-amal ascending-triangle breakout logic extended to descending break-up. Research only — not trade advice.",
    });
  } catch (err) {
    console.error("triangle api", err);
    return NextResponse.json({ rows: [], error: "triangle_scan_failed" }, { status: 500 });
  }
}
