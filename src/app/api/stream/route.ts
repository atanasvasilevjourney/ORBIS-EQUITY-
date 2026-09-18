import { NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { lseStreamConfigured, quoteIsFresh } from "@/lib/lseLive";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9.\-]{1,20}$/.test(s))
    .slice(0, 40);

  const stream = new ReadableStream({
    async start(controller) {
      const configured = lseStreamConfigured();
      controller.enqueue(encode({
        type: "hello",
        source: "lse_ws",
        configured,
        ws: "wss://data-ws.londonstrategicedge.com",
        note: configured
          ? "ticks land in quotes_last via python -m pipeline.ingest.lse_live"
          : "LSE_API_KEY missing — PostgREST catalog is not a stream",
      }));

      const ticks = 40;
      for (let i = 0; i < ticks; i++) {
        if (req.signal.aborted) break;
        try {
          const sb = createServerClient();
          let q = sb.from("quotes_last").select("symbol, last, bid, ask, volume, ts, source, replay, updated_at");
          if (symbols.length) q = q.in("symbol", symbols);
          const { data } = await q.order("updated_at", { ascending: false }).limit(80);
          const rows = data ?? [];
          const streaming = rows.some((r) => quoteIsFresh(r.updated_at));
          controller.enqueue(encode({ type: "quotes", streaming, quotes: rows }));
        } catch (err) {
          controller.enqueue(encode({ type: "error", message: err instanceof Error ? err.message : "stream" }));
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
