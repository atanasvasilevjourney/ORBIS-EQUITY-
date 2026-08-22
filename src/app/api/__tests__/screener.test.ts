import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/screener", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns flattened screener rows", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        trend_radar: () => ({
          data: [{
            symbol: "AAPL",
            state: 1,
            quality_rank: 75,
            z_mom: 1.2,
            f_ewmac: 0.8,
            z_52: -0.05,
            breakout_active: true,
            volume_confirmed: true,
            convergence_count: 4,
            state_changed_at: "2026-01-01",
            computed_at: "2026-01-01",
          }],
          error: null,
          count: 1,
        }),
        universe_members: () => ({
          data: [{
            symbol: "AAPL",
            company_name: "Apple Inc.",
            sector: "Technology",
            industry: "Consumer Electronics",
            country: "US",
            exchange: "NASDAQ",
            tier: "us_large",
          }],
          error: null,
        }),
        fundamentals_snapshot: () => ({
          data: [{
            symbol: "AAPL",
            price: 180,
            market_cap: 2800000,
            pe_ratio: 28,
            dividend_yield: 0.005,
          }],
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
  });

  it("filters by direction=bull", async () => {
    const eqCalls: string[] = [];
    const sb = createMockSupabase({
      trend_radar: () => ({ data: [], error: null, count: 0 }),
      universe_members: () => ({ data: [], error: null }),
      fundamentals_snapshot: () => ({ data: [], error: null }),
    });
    const origEq = sb.from("trend_radar").eq;
    sb.from = (table: string) => {
      const chain = createMockSupabase({
        trend_radar: () => ({ data: [], error: null, count: 0 }),
        universe_members: () => ({ data: [], error: null }),
        fundamentals_snapshot: () => ({ data: [], error: null }),
      }).from(table);
      chain.eq = (col: string, val: unknown) => {
        eqCalls.push(`${col}=${val}`);
        return chain;
      };
      return chain;
    };
    mockCreateServerClient.mockReturnValue(sb);

    const { GET } = await import("../screener/route");
    const req = new NextRequest("http://localhost/api/screener?direction=bull");
    await GET(req);

    expect(eqCalls).toContain("state=1");
  });

  it("filters by region=us", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        trend_radar: () => ({
          data: [
            { symbol: "AAPL", state: 1, quality_rank: 70, z_mom: 0, f_ewmac: 0, z_52: 0, breakout_active: false, volume_confirmed: false, convergence_count: 1, state_changed_at: null, computed_at: null },
            { symbol: "BP", state: 0, quality_rank: 50, z_mom: 0, f_ewmac: 0, z_52: 0, breakout_active: false, volume_confirmed: false, convergence_count: 1, state_changed_at: null, computed_at: null },
          ],
          error: null,
          count: 2,
        }),
        universe_members: () => ({
          data: [
            { symbol: "AAPL", company_name: "Apple", sector: "Tech", industry: "", country: "US", exchange: "NASDAQ", tier: "us_large" },
            { symbol: "BP", company_name: "BP", sector: "Energy", industry: "", country: "GB", exchange: "LSE", tier: "uk" },
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
        universe_members: () => ({ data: [], error: null }),
        fundamentals_snapshot: () => ({ data: [], error: null }),
      })
    );

    const { GET } = await import("../screener/route");
    const req = new NextRequest("http://localhost/api/screener");
    const res = await GET(req);

    expect(res.status).toBe(500);
  });

  it("caps limit at 1000", async () => {
    let capturedLimit = 0;
    const sb = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        const methods = ["select", "eq", "gte", "order"];
        for (const m of methods) chain[m] = () => chain;
        chain.limit = (n: number) => { capturedLimit = n; return chain; };
        chain.then = (onFulfilled?: (v: QueryResult) => unknown) =>
          Promise.resolve(
            table === "trend_radar"
              ? { data: [], error: null, count: 0 }
              : { data: [], error: null }
          ).then(onFulfilled);
        return chain;
      },
    };
    mockCreateServerClient.mockReturnValue(sb);

    const { GET } = await import("../screener/route");
    const req = new NextRequest("http://localhost/api/screener?limit=5000");
    await GET(req);

    expect(capturedLimit).toBe(1000);
  });
});
