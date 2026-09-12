import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

const radarRow = (symbol: string, overrides: Record<string, unknown> = {}) => ({
  symbol,
  state: 1,
  quality_rank: 75,
  z_mom: 1.2,
  f_ewmac: 0.8,
  z_52: -0.05,
  breakout_active: true,
  volume_confirmed: true,
  kama_regime: 1,
  adx: 25,
  entry_timing: null,
  convergence_count: 4,
  state_changed_at: "2026-01-01",
  computed_at: "2026-01-01",
  ...overrides,
});

describe("GET /api/screener", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns flattened screener rows", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        trend_radar: () => ({ data: [radarRow("AAPL")], error: null }),
        universe_members: () => ({
          data: [
            {
              symbol: "AAPL",
              company_name: "Apple Inc.",
              sector: "Technology",
              industry: "Consumer Electronics",
              country: "US",
              exchange: "NASDAQ",
              tier: "us_large",
            },
          ],
          error: null,
        }),
        fundamentals_snapshot: () => ({
          data: [
            {
              symbol: "AAPL",
              price: 180,
              market_cap: 2800000,
              pe_ratio: 28,
              dividend_yield: 0.005,
            },
          ],
          error: null,
        }),
      })
    );

    const { GET } = await import("../screener/route");
    const req = new NextRequest("http://localhost/api/screener");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].symbol).toBe("AAPL");
    expect(body[0].rank).toBe(75);
    expect(body[0].companyName).toBe("Apple Inc.");
    expect(body[0].kamaRegime).toBe(1);
  });

  it("filters by direction=bull via state=1", async () => {
    const eqCalls: string[] = [];
    mockCreateServerClient.mockReturnValue({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        const methods = ["select", "gte", "order", "range", "limit", "maybeSingle", "single"];
        for (const m of methods) chain[m] = () => chain;
        chain.eq = (col: string, val: unknown) => {
          eqCalls.push(`${col}=${val}`);
          return chain;
        };
        chain.then = (onFulfilled?: (v: unknown) => unknown) =>
          Promise.resolve(
            table === "trend_radar" || table === "universe_members" || table === "fundamentals_snapshot"
              ? { data: [], error: null }
              : { data: [], error: null }
          ).then(onFulfilled);
        return chain;
      },
    });

    const { GET } = await import("../screener/route");
    const req = new NextRequest("http://localhost/api/screener?direction=bull");
    await GET(req);

    expect(eqCalls).toContain("state=1");
  });

  it("filters by region=us", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        trend_radar: () => ({
          data: [radarRow("AAPL"), radarRow("BP", { state: 0, quality_rank: 50 })],
          error: null,
        }),
        universe_members: () => ({
          data: [
            {
              symbol: "AAPL",
              company_name: "Apple",
              sector: "Tech",
              industry: "",
              country: "US",
              exchange: "NASDAQ",
              tier: "us_large",
            },
            {
              symbol: "BP",
              company_name: "BP",
              sector: "Energy",
              industry: "",
              country: "GB",
              exchange: "LSE",
              tier: "uk",
            },
          ],
          error: null,
        }),
        fundamentals_snapshot: () => ({ data: [], error: null }),
      })
    );

    const { GET } = await import("../screener/route");
    const req = new NextRequest("http://localhost/api/screener?region=us");
    const res = await GET(req);
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].symbol).toBe("AAPL");
  });

  it("returns 500 on Supabase error", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        trend_radar: () => ({ data: null, error: { message: "DB error" } }),
        universe_members: () => ({ data: null, error: { message: "DB error" } }),
        fundamentals_snapshot: () => ({ data: null, error: { message: "DB error" } }),
      })
    );

    const { GET } = await import("../screener/route");
    const req = new NextRequest("http://localhost/api/screener");
    const res = await GET(req);

    expect(res.status).toBe(500);
  });

  it("caps limit at 1000", async () => {
    const many = Array.from({ length: 1100 }, (_, i) =>
      radarRow(`T${i}`, { quality_rank: 90 })
    );
    const universe = many.map((r) => ({
      symbol: r.symbol,
      company_name: r.symbol,
      sector: "Tech",
      industry: "",
      country: "US",
      exchange: "NASDAQ",
      tier: "us_large",
    }));

    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        trend_radar: () => ({ data: many, error: null }),
        universe_members: () => ({ data: universe, error: null }),
        fundamentals_snapshot: () => ({ data: [], error: null }),
      })
    );

    const { GET } = await import("../screener/route");
    const req = new NextRequest("http://localhost/api/screener?limit=5000");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1000);
  });
});
