import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/ema200", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns watchlist rows for retrace setup", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        ema200_features: () => ({
          data: [
            {
              symbol: "AMZN",
              bar_date: "2026-10-10",
              close: 250,
              ema200: 248,
              dist_atr: 0.35,
              days_above: 24,
              ema200_slope: 0.001,
              rvol: 1.1,
              regime: "bull",
            },
          ],
          error: null,
        }),
        universe_members: () => ({
          data: [
            {
              symbol: "AMZN",
              company_name: "Amazon",
              sector: "Retail",
              country: "US",
            },
          ],
          error: null,
        }),
        fundamentals_snapshot: () => ({ data: [], error: null }),
      })
    );

    const { GET } = await import("../ema200/route");
    const res = await GET(new NextRequest("http://localhost/api/ema200"));
    const body = await res.json();
    expect(body.mode).toBe("watchlist_only");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].symbol).toBe("AMZN");
    expect(body.rows[0].setup).toBe("RETRACE_HELD");
  });
});
