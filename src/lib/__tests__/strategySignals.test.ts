import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockSupabase } from "@/app/api/__tests__/helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("fetchLatestStrategySignals", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns the latest as_of batch", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        strategy_signals: (select?: string) => {
          if (select?.includes("as_of") && !select.includes("symbol")) {
            return { data: { as_of: "2026-03-01", known_on: "2026-03-01" }, error: null };
          }
          return {
            data: [
              {
                strategy_id: "donchian_vwap",
                symbol: "AAA",
                as_of: "2026-03-01",
                known_on: "2026-03-01",
                side: "BUY",
                score: 0.5,
                stop: null,
                size_hint: null,
                reason: "donchian55_vwap_eligible",
              },
            ],
            error: null,
          };
        },
      })
    );

    const { fetchLatestStrategySignals } = await import("@/lib/strategySignals");
    const sb = mockCreateServerClient();
    const batch = await fetchLatestStrategySignals(sb, "donchian_vwap");
    expect(batch.asOf).toBe("2026-03-01");
    expect(batch.signals).toHaveLength(1);
    expect(batch.signals[0].symbol).toBe("AAA");
  });
});
