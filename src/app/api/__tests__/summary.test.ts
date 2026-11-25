import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

vi.mock("@/lib/sessionQuotes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sessionQuotes")>("@/lib/sessionQuotes");
  return {
    ...actual,
    fetchSessionQuotes: async (
      _sb: unknown,
      symbols: string[],
      _expected?: string,
      _opts?: unknown
    ) => {
      const zBySym: Record<string, number> = { A: 5, B: -2, C: 1 };
      const map = new Map<string, import("@/lib/sessionQuotes").SessionQuote>();
      for (const sym of symbols) {
        let day = zBySym[sym];
        if (day == null && /^S(\d+)$/.test(sym)) {
          const i = parseInt(sym.slice(1), 10);
          day = i < 2 ? 1 : -0.5;
        }
        day ??= 0;
        map.set(sym, {
          last: 100,
          dayPct: day,
          asOf: "2026-11-24",
          stale: false,
          volume: null,
        });
      }
      return map;
    },
  };
});

describe("GET /api/summary", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns market summary with breadth stats", async () => {
    const today = new Date().toISOString().split("T")[0];
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        daily_brief: () => ({
          data: {
            asof_date: today,
            brief: "Risk-On - 55% GREEN",
            inputs: {
              posture_score: 65,
              posture_label: "Risk-On",
              breadth: { best_sector: "Technology", worst_sector: "Energy" },
              region_breadth: { US: 60 },
            },
          },
          error: null,
        }),
        trend_radar: () => ({
          data: [
            { symbol: "A", state: 1, quality_rank: 70, z_mom: 5 },
            { symbol: "B", state: -1, quality_rank: 30, z_mom: -2 },
            { symbol: "C", state: 0, quality_rank: 50, z_mom: 1 },
          ],
          error: null,
        }),
        universe_members: () => ({
          data: [
            { symbol: "A", sector: "Tech" },
            { symbol: "B", sector: "Energy" },
            { symbol: "C", sector: "Tech" },
          ],
          error: null,
        }),
        prices_daily: () => ({
          data: { date: today },
          error: null,
        }),
      })
    );

    const { GET } = await import("../summary/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.breadth.total).toBe(3);
    expect(body.breadth.onList).toBe(1);
    expect(body.breadth.onListPct).toBe(33);
    expect(body.breadth.advancersPct).toBe(67);
    expect(body.breadth.downDay).toBe(1);
    expect(body.breadth.greens).toBe(1);
    expect(body.breadth.reds).toBe(1);
    expect(body.posture).toBe(67);
    expect(body.postureLabel).toBe("Slight Bullish");
    expect(body.stale).toBe(false);
  });

  it("uses live posture when brief is older than prices", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        daily_brief: () => ({
          data: {
            asof_date: "2026-11-19",
            brief: "Slight Bullish — 68% of names up",
            inputs: {
              posture_score: 68,
              posture_label: "Slight Bullish",
              breadth: { best_sector: "Financials", worst_sector: "Tech" },
            },
          },
          error: null,
        }),
        trend_radar: () => ({
          data: Array.from({ length: 10 }, (_, i) => ({
            symbol: `S${i}`,
            state: 0,
            quality_rank: 40,
            z_mom: i < 2 ? 1 : -0.5,
          })),
          error: null,
        }),
        universe_members: () => ({
          data: [{ symbol: "S0", sector: "Tech" }],
          error: null,
        }),
        prices_daily: () => ({
          data: { date: "2026-11-20" },
          error: null,
        }),
      })
    );

    const { GET } = await import("../summary/route");
    const res = await GET();
    const body = await res.json();

    expect(body.posture).toBe(20);
    expect(body.postureBriefStale).toBe(true);
    expect(body.briefText).toBeNull();
  });

  it("handles missing daily brief gracefully", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        daily_brief: () => ({ data: null, error: null }),
        trend_radar: () => ({ data: [], error: null }),
      })
    );

    const { GET } = await import("../summary/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.asOfDate).toBeNull();
    expect(body.breadth.total).toBe(0);
  });
});
