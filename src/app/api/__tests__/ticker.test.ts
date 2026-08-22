import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/ticker/[ticker]", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns 400 for invalid ticker format", async () => {
    const { GET } = await import("../ticker/[ticker]/route");
    const req = new NextRequest("http://localhost/api/ticker/INVALID!!");
    const res = await GET(req, { params: { ticker: "INVALID!!" } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid ticker format");
  });

  it("returns 404 when ticker not in universe", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        trend_radar: () => ({ data: null, error: { code: "PGRST116" } }),
        fundamentals_snapshot: () => ({ data: null, error: { code: "PGRST116" } }),
        universe_members: () => ({ data: null, error: { code: "PGRST116" } }),
        earnings_calendar: () => ({ data: [], error: null }),
        insider_trades_snapshot: () => ({ data: [], error: null }),
      })
    );

    const { GET } = await import("../ticker/[ticker]/route");
    const req = new NextRequest("http://localhost/api/ticker/FAKE");
    const res = await GET(req, { params: { ticker: "FAKE" } });

    expect(res.status).toBe(404);
  });

  it("returns ticker detail payload", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        trend_radar: () => ({
          data: { symbol: "AAPL", state: 1, quality_rank: 80 },
          error: null,
        }),
        fundamentals_snapshot: () => ({
          data: { symbol: "AAPL", price: 180, market_cap: 2800000 },
          error: null,
        }),
        universe_members: () => ({
          data: { symbol: "AAPL", company_name: "Apple Inc.", sector: "Technology" },
          error: null,
        }),
        earnings_calendar: () => ({ data: [], error: null }),
        insider_trades_snapshot: () => ({ data: [], error: null }),
      })
    );

    const { GET } = await import("../ticker/[ticker]/route");
    const req = new NextRequest("http://localhost/api/ticker/AAPL");
    const res = await GET(req, { params: { ticker: "AAPL" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.universe.symbol).toBe("AAPL");
    expect(body.radar.quality_rank).toBe(80);
    expect(body.earnings).toEqual([]);
  });

  it("returns 500 on unexpected Supabase error", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        trend_radar: () => ({ data: null, error: { code: "500", message: "fail" } }),
        fundamentals_snapshot: () => ({ data: null, error: { code: "PGRST116" } }),
        universe_members: () => ({ data: { symbol: "AAPL" }, error: null }),
        earnings_calendar: () => ({ data: [], error: null }),
        insider_trades_snapshot: () => ({ data: [], error: null }),
      })
    );

    const { GET } = await import("../ticker/[ticker]/route");
    const req = new NextRequest("http://localhost/api/ticker/AAPL");
    const res = await GET(req, { params: { ticker: "AAPL" } });

    expect(res.status).toBe(500);
  });
});
