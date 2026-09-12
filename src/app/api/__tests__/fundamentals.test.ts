import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/fundamentals", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns fundamentals rows with sectors list", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        fundamentals_snapshot: () => ({
          data: [{
            symbol: "AAPL",
            price: 180,
            market_cap: 2800000,
            pe_ratio: 28,
            pb_ratio: 40,
            ps_ratio: 7,
            p_fcf_ratio: 25,
            ev_ebitda: 20,
            earnings_yield: 0.04,
            fcf_yield: 0.03,
            dividend_yield: 0.005,
            gross_margin: 0.45,
            operating_margin: 0.30,
            net_margin: 0.25,
            roe: 1.5,
            roa: 0.2,
            roic: 0.5,
            current_ratio: 1.0,
            debt_to_equity: 1.5,
            revenue_growth_1y: 0.08,
            revenue_growth_3y: 0.10,
            net_income_growth_1y: 0.05,
            eps_growth_1y: 0.06,
            f_score: 7,
          }],
          error: null,
          count: 1,
        }),
        universe_members: () => ({
          data: [{
            symbol: "AAPL",
            company_name: "Apple Inc.",
            sector: "Technology",
            industry: "Consumer Electronics",
            country: "US",
            exchange: "NASDAQ",
            tier: "us_large",
          }],
          error: null,
        }),
        trend_radar: () => ({
          data: [{ symbol: "AAPL", state: 1, quality_rank: 75 }],
          error: null,
          count: 1,
        }),
      })
    );

    const { GET } = await import("../fundamentals/route");
    const req = new NextRequest("http://localhost/api/fundamentals");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].symbol).toBe("AAPL");
    expect(body.rows[0].fScore).toBe(7);
    expect(body.sectors).toContain("Technology");
  });

  it("returns 500 on Supabase error", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        fundamentals_snapshot: () => ({ data: null, error: { message: "fail" } }),
        universe_members: () => ({ data: [], error: null }),
        trend_radar: () => ({ data: [], error: null }),
      })
    );

    const { GET } = await import("../fundamentals/route");
    const req = new NextRequest("http://localhost/api/fundamentals");
    const res = await GET(req);

    expect(res.status).toBe(500);
  });
});
