import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { resolveUniverseDesk } from "@/lib/resolveIndexDesk";
import { parseUniverseDeskParam } from "@/lib/universeDesk";

export const revalidate = 3600;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const universe = sp.get("universe") ?? "nasdaq_all";
    const format = (sp.get("format") ?? "csv").toLowerCase();

    const desk = parseUniverseDeskParam(universe);
    if (!desk || desk === "watchlist") {
      return NextResponse.json({ error: "Invalid universe" }, { status: 400 });
    }

    const sb = createServerClient();
    const resolved = await resolveUniverseDesk(sb, desk, []);
    const symbols = [...resolved.symbols].sort();

    if (format === "json") {
      return NextResponse.json({
        universe: resolved.universeKey,
        count: symbols.length,
        symbols,
      });
    }

    const lines = ["symbol", ...symbols];
    const body = lines.join("\n");
    const filename = `orbis-${resolved.universeKey}-symbols.csv`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Universe export error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
