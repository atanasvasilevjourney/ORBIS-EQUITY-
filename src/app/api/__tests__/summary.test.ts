import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/summary", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns market summary with breadth stats", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        daily_brief: () => ({
          data: {
            asof_date: new Date().toISOString().split("T")[0],
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
            { state: 1, quality_rank: 70, z_mom: 5 },
            { state: -1, quality_rank: 30, z_mom: -2 },
            { state: 0, quality_rank: 50, z_mom: 1 },
          ],
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
    expect(body.postureLabel).toBe("Risk-On");
    expect(body.stale).toBe(false);
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
