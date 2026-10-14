import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/research-weekly", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns latest weekly pack and setups", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        research_weekly_pack: () => ({
          data: [
            {
              pack_id: "weekly-2026-10-12",
              week_start: "2026-10-12",
              asof_date: new Date().toISOString().split("T")[0],
              headline: "SPY above MA200 · 2 setups",
              macro: [{ symbol: "SPY", narrative: "test" }],
              internals: { trendRadar: { universe: 100 } },
              sector_rotation: { leaders: [] },
              risk_notes: { riskPerTradePct: 1 },
              config_version: 1,
              computed_at: new Date().toISOString(),
            },
          ],
          error: null,
        }),
        research_setups: () => ({
          data: [
            {
              pack_id: "weekly-2026-10-12",
              rank: 1,
              symbol: "NVDA",
              company_name: "NVIDIA",
              theme_bucket: "semis",
              desk_source: "trend_radar",
              side: "LONG",
              entry: 500,
              stop: 480,
              target: 530,
              rr: 1.5,
              orbis_score: 88,
              status: "pending",
              rationale: "test",
              rules: { noTradeUntilEntry: true },
            },
          ],
          error: null,
        }),
      })
    );

    const { GET } = await import("../research-weekly/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary.packId).toBe("weekly-2026-10-12");
    expect(body.setups).toHaveLength(1);
    expect(body.setups[0].ticker).toBe("NVDA");
    expect(body.setups[0].status).toBe("pending");
    expect(body.macro).toHaveLength(1);
  });

  it("handles empty pack table", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        research_weekly_pack: () => ({ data: [], error: null }),
      })
    );

    const { GET } = await import("../research-weekly/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary).toBeNull();
    expect(body.setups).toEqual([]);
    expect(body.stale).toBe(true);
  });
});
