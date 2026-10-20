import { NextRequest, NextResponse } from "next/server";
import { rateLimitAllowed } from "@/lib/rateLimit";
import { searchYahooSymbols } from "@/lib/yahooSearch";

export const revalidate = 60;

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimitAllowed(`symbols:${ip}`, 40, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded", hits: [] }, { status: 429 });
  }
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const nasdaqOnly = sp.get("all") !== "1";
  const limit = Math.min(parseInt(sp.get("limit") ?? "25", 10), 40);

  if (!q.trim()) {
    return NextResponse.json({ hits: [], query: "" });
  }

  try {
    const hits = await searchYahooSymbols(q, { nasdaqOnly, limit });
    return NextResponse.json({ hits, query: q.trim(), nasdaqOnly });
  } catch (err) {
    console.error("Symbol search error:", err);
    return NextResponse.json({ error: "Search failed", hits: [] }, { status: 502 });
  }
}
