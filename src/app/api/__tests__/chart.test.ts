import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();
const vaultMock = vi.hoisted(() => vi.fn(async () => [] as { time: number; open: number; high: number; low: number; close: number }[]));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

vi.mock("@/lib/lseLive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lseLive")>("@/lib/lseLive");
  return { ...actual, fetchLseVaultCandles: vaultMock };
});

describe("GET /api/chart/[ticker]", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
    vaultMock.mockReset();
    vaultMock.mockResolvedValue([]);
  });

  it("prefers LSE vault 5m when at least 20 bars land", async () => {
    vaultMock.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        time: 1_726_000_000 + i * 300,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
      }))
    );
    const { GET } = await import("../chart/[ticker]/route");
    const res = await GET(new NextRequest("http://localhost/api/chart/AAPL?interval=5m"), {
      params: { ticker: "AAPL" },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source).toBe("lse");
    expect(body.interval).toBe("5m");
    expect(body.candles).toHaveLength(20);
  });

  it("falls back to prices_daily for 1d", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        prices_daily: () => ({
          data: [
            { date: "2026-09-17", open: 1, high: 2, low: 1, close: 1.5, volume: 10 },
            { date: "2026-09-16", open: 1, high: 1.2, low: 0.9, close: 1, volume: 8 },
          ],
          error: null,
        }),
      })
    );
    const { GET } = await import("../chart/[ticker]/route");
    const res = await GET(new NextRequest("http://localhost/api/chart/AAPL?interval=1d"), {
      params: { ticker: "AAPL" },
    });
    const body = await res.json();
    expect(body.source).toBe("prices_daily");
    expect(body.interval).toBe("1d");
    expect(body.candles.length).toBe(2);
  });
});
