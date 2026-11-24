import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

vi.mock("@/lib/yahooDaily", () => ({
  fetchYahooDaily: vi.fn(async () => []),
}));

describe("GET /api/trend-band", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns DB rows when present", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        trend_band_scan_runs: () => ({
          data: [{ asof_date: "2026-03-01", headline: "3 pullbacks", names: 3 }],
          error: null,
        }),
        trend_band_setups: () => ({
          data: [
            {
              symbol: "XLE",
              bar_date: "2026-03-01",
              timeframe: "1d",
              asset_class: "etf",
              setup_kind: "pullback",
              score: 72,
              close: 95,
              band_lo: 90,
              band_hi: 94,
              ema200_high: 94,
              ema200_low: 90,
              invalidation: 90,
              dist_to_band_pct: 1.1,
              pullback_pct: 8,
              advance_pct: 12,
              band_slope_pct: 0.1,
              band_color: "green",
              band_flip: false,
              days_since_flip: null,
              dual_timeframe: false,
              spark: [],
            },
          ],
          error: null,
        }),
        universe_members: () => ({
          data: [{ symbol: "XLE", company_name: "Energy Select" }],
          error: null,
        }),
      })
    );

    const { GET } = await import("../trend-band/route");
    const res = await GET(new NextRequest("http://localhost/api/trend-band"));
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].symbol).toBe("XLE");
    expect(body.dataSource).toBe("trend_band_setups");
  });
});