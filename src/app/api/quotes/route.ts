import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { lseStreamConfigured, quoteIsFresh } from "@/lib/lseLive";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9.\-]{1,20}$/.test(s))
    .slice(0, 80);

  try {
    const sb = createServerClient();
    let q = sb.from("quotes_last").select("symbol, last, bid, ask, volume, ts, source, replay, updated_at");
    if (symbols.length) q = q.in("symbol", symbols);
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(200);
    if (error) {
      return NextResponse.json({
        configured: lseStreamConfigured(),
        streaming: false,
        quotes: [],
        error: error.message.includes("quotes_last")
          ? "quotes_last missing — apply migration 022"
          : "quotes query failed",
      });
    }
    const rows = data ?? [];
    const streaming = rows.some((r) => quoteIsFresh(r.updated_at));
    return NextResponse.json({
      configured: lseStreamConfigured(),
      streaming,
      source: "lse_ws",
      quotes: rows,
    });
  } catch (err) {
    console.error("quotes API", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
