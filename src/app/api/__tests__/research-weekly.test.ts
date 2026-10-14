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

  it("returns empty payload when no runs", async () => {
    mockFetchAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const { GET } = await import("../research-weekly/route");
    const res = await GET();
    const body = await res.json();
    expect(body.setups).toEqual([]);
    expect(body.stale).toBe(true);
  });

  it("returns setups for latest run", async () => {
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
          source: "test",
          theme: "Tech",
          side: "LONG",
          entry_px: 100,
          stop_px: 95,
          target_px: 110,
          rr: 2,
          last_px: 99,
          quality_rank: 80,
          factor_score: 70,
          rationale: "r",
        },
      ]);
    const { GET } = await import("../research-weekly/route");
    const res = await GET();
    const body = await res.json();
    expect(body.setups).toHaveLength(1);
    expect(body.setups[0].ticker).toBe("AAPL");
    expect(body.summary.runId).toBe("rw-1");
  });
});
