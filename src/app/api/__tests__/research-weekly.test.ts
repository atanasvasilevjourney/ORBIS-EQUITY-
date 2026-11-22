import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetchAll = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({}),
}));

vi.mock("@/lib/supabase/paginate", () => ({
  fetchAll: (...args: unknown[]) => mockFetchAll(...args),
}));

vi.mock("@/lib/freshness", () => ({
  evaluateFreshness: () => ({ stale: false, signalsSuppressed: false }),
}));

describe("GET /api/research-weekly", () => {
  beforeEach(() => {
    mockFetchAll.mockReset();
  });

  it("returns empty horizons when no runs", async () => {
    mockFetchAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const { GET } = await import("../research-weekly/route");
    const res = await GET();
    const body = await res.json();
    expect(body.setups).toEqual([]);
    expect(body.horizons.short_term).toEqual([]);
    expect(body.shorts).toEqual([]);
    expect(body.stale).toBe(true);
  });

  it("returns horizons and shorts for latest run", async () => {
    mockFetchAll
      .mockResolvedValueOnce([
        {
          run_id: "rw-1",
          week_ending: "2026-10-10",
          headline: "Test",
          macro: { symbol: "SPY" },
          sectors: [],
          risk_notes: ["note"],
          computed_at: "2026-10-10T12:00:00Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          run_id: "rw-1",
          rank: 1,
          symbol: "AAPL",
          company_name: "Apple",
          source: "trend_radar",
          theme: "Tech",
          side: "LONG",
          horizon: "medium_term",
          confidence: "High",
          entry_px: 100,
          stop_px: 95,
          target_px: 110,
          rr: 2,
          last_px: 99,
          quality_rank: 80,
          factor_score: 70,
          rationale: "r",
          meta: {
            entry_zone: [99.5, 100.5],
            wrong_test: "close below stop",
            sources: ["trend_radar"],
            evidence: { ticker: "SOURCED" },
          },
        },
        {
          run_id: "rw-1",
          rank: 2,
          symbol: "XYZ",
          company_name: "X",
          source: "trend_radar+analysis_names",
          theme: "Energy",
          side: "SHORT",
          horizon: "short_term",
          confidence: "Med",
          entry_px: 50,
          stop_px: 52,
          target_px: 46,
          rr: 2,
          last_px: 51,
          quality_rank: 35,
          factor_score: 40,
          rationale: "short r",
          meta: {
            entry_zone: [49.5, 50.5],
            wrong_test: "reclaim stop",
            sources: ["trend_radar", "analysis_names"],
          },
        },
      ]);
    const { GET } = await import("../research-weekly/route");
    const res = await GET();
    const body = await res.json();
    expect(body.ideas).toHaveLength(2);
    expect(body.horizons.medium_term).toHaveLength(1);
    expect(body.horizons.short_term).toHaveLength(1);
    expect(body.shorts).toHaveLength(1);
    expect(body.shorts[0].ticker).toBe("XYZ");
    expect(body.shorts[0].direction).toBe("SHORT");
    expect(body.summary.shortCount).toBe(1);
    expect(body.setups[0].entryZone).toEqual([99.5, 100.5]);
  });
});