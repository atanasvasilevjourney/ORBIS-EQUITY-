import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

vi.mock("@/lib/lseLive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lseLive")>("@/lib/lseLive");
  return { ...actual, lseStreamConfigured: () => true };
});

describe("GET /api/quotes", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns last prints and streaming when quotes_last is fresh", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        quotes_last: () => ({
          data: [
            {
              symbol: "AAPL",
              last: 337,
              bid: 336.9,
              ask: 337.1,
              volume: 100,
              ts: new Date().toISOString(),
              source: "lse_ws",
              replay: false,
              updated_at: new Date().toISOString(),
            },
          ],
          error: null,
        }),
      })
    );
    const { GET } = await import("../quotes/route");
    const res = await GET(new NextRequest("http://localhost/api/quotes?symbols=AAPL"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.streaming).toBe(true);
    expect(body.source).toBe("lse_ws");
    expect(body.quotes[0].symbol).toBe("AAPL");
    expect(body.quotes[0].last).toBe(337);
  });

  it("says to apply migration 022 when quotes_last is missing", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        quotes_last: () => ({
          data: null,
          error: { message: "Could not find the table 'public.quotes_last' in the schema cache" },
        }),
      })
    );
    const { GET } = await import("../quotes/route");
    const res = await GET(new NextRequest("http://localhost/api/quotes"));
    const body = await res.json();
    expect(body.streaming).toBe(false);
    expect(body.quotes).toEqual([]);
    expect(body.error).toContain("migration 022");
  });
});
