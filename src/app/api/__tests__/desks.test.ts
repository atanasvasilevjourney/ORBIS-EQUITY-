import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/desks", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("flags a missing cash snapshot as lite/stale and reports the EOD book", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        perp_runs: () => ({ data: [], error: null }),
        quantropy_runs: () => ({
          data: [{ asof_date: "2026-09-18", computed_at: "2026-09-18T21:00:00Z", names: 12, headline: "q" }],
          error: null,
        }),
        sector_rotation_runs: () => ({ data: [], error: null }),
        prices_daily: () => ({ data: [{ date: "2026-09-18" }], error: null }),
        quotes_last: () => ({ data: [], error: null }),
      })
    );
    const { GET } = await import("../desks/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.cash.lite).toBe(true);
    expect(body.cash.stale).toBe(true);
    expect(body.priceAsOf).toBe("2026-09-18");
    expect(body.expectedLastClose).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
