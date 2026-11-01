import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/factors", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns style summaries and top composite", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        fundamentals_snapshot: () => ({
          data: [
            {
              symbol: "AAPL",
              value_score: 80,
              quality_score: 75,
              growth_score: 60,
              earnings_quality_score: 70,
              leverage_score: 65,
              composite_factor_score: 72,
              factor_computed_at: "2026-10-30T00:00:00Z",
            },
            {
              symbol: "MSFT",
              value_score: 55,
              quality_score: 90,
              growth_score: 85,
              earnings_quality_score: null,
              leverage_score: null,
              composite_factor_score: 78,
              factor_computed_at: "2026-10-30T00:00:00Z",
            },
            {
              symbol: "GOOG",
              value_score: 50,
              quality_score: 60,
              growth_score: 55,
              earnings_quality_score: 50,
              leverage_score: 50,
              composite_factor_score: 55,
              factor_computed_at: "2026-10-30T00:00:00Z",
            },
          ],
          error: null,
          count: 3,
        }),
        universe_members: () => ({
          data: [
            { symbol: "AAPL", company_name: "Apple", sector: "Technology" },
            { symbol: "MSFT", company_name: "Microsoft", sector: "Technology" },
            { symbol: "GOOG", company_name: "Alphabet", sector: "Technology" },
          ],
          error: null,
        }),
      })
    );

    const { GET } = await import("../factors/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary.withComposite).toBe(3);
    expect(body.styles).toHaveLength(5);
    expect(body.topComposite[0].symbol).toBe("MSFT");
    expect(body.sectors[0].sector).toBe("Technology");
  });
});
