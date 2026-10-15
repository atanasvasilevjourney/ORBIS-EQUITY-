import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/fundamentals/screener", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("filters by preset ranges and watchlist", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        fundamentals_snapshot: () => ({
          data: [
            {
              symbol: "AAPL",
              price: 180,
              market_cap: 3e12,
              pe_ratio: 28,
              pb_ratio: 40,
              ps_ratio: 7,
              ev_ebitda: 20,
              dividend_yield: 0.005,
              roe: 1.5,
              roa: 0.2,
              roic: 0.5,
              net_margin: 0.25,
              current_ratio: 1.0,
              debt_to_equity: 1.5,
              revenue_growth_1y: 0.08,
              eps_growth_1y: 0.06,
              f_score: 7,
              value_score: 40,
              quality_score: 80,
              growth_score: 60,
              earnings_quality_score: 70,
              leverage_score: 55,
              composite_factor_score: 72,
              fundamental_verdict: "STRONG",
              fundamental_summary: "ok",
            },
            {
              symbol: "VALUE",
              price: 50,
              market_cap: 5e9,
              pe_ratio: 12,
              pb_ratio: 1.2,
              ps_ratio: 2,
              ev_ebitda: 8,
              dividend_yield: 0.02,
              roe: 0.14,
              roa: 0.08,
              roic: 0.1,
              net_margin: 0.12,
              current_ratio: 2.0,
              debt_to_equity: 0.4,
              revenue_growth_1y: 0.05,
              eps_growth_1y: 0.1,
              f_score: 7,
              value_score: 75,
              quality_score: 70,
              growth_score: 55,
              earnings_quality_score: 65,
              leverage_score: 70,
              composite_factor_score: 68,
              fundamental_verdict: "ATTRACTIVE",
              fundamental_summary: "ok",
            },
          ],
          error: null,
          count: 2,
        }),
        universe_members: () => ({
          data: [
            {
              symbol: "AAPL",
              company_name: "Apple",
              sector: "Technology",
              industry: "Hardware",
              country: "US",
              exchange: "NASDAQ",
              tier: "us_large",
            },
            {
              symbol: "VALUE",
              company_name: "Value Co",
              sector: "Financials",
              industry: "Banks",
              country: "US",
              exchange: "NYSE",
              tier: "us_mid",
            },
          ],
          error: null,
        }),
        trend_radar: () => ({
          data: [
            { symbol: "AAPL", state: 1, quality_rank: 80 },
            { symbol: "VALUE", state: 1, quality_rank: 65 },
          ],
          error: null,
          count: 2,
        }),
      })
    );

    const { GET } = await import("../fundamentals/screener/route");
    const req = new NextRequest(
      "http://localhost/api/fundamentals/screener?preset=graham&watchlist_only=1"
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rows.map((r: { symbol: string }) => r.symbol)).toEqual(["VALUE"]);
    expect(body.query.preset).toBe("graham");
  });
});
