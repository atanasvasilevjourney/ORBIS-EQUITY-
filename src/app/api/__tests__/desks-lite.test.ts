import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

function px(symbol: string, n = 80, g = 1.002) {
  return Array.from({ length: n }, (_, i) => ({
    symbol,
    date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
    close: 50 * g ** i,
  }));
}

describe("GET /api/quantropy", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns lite corr from prices_daily when there is no snapshot", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        quantropy_runs: () => ({ data: [], error: null }),
        universe_members: () => ({
          data: [
            { symbol: "AAPL", sector: "Technology", company_name: "Apple" },
            { symbol: "XOM", sector: "Energy", company_name: "Exxon" },
          ],
          error: null,
        }),
        prices_daily: () => ({
          data: [...px("AAPL", 90, 1.003), ...px("XOM", 90, 1.001)],
          error: null,
        }),
      })
    );
    const { GET } = await import("../quantropy/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.lite).toBe(true);
    expect(body.corr.labels.length).toBeGreaterThanOrEqual(2);
    expect(body.names.length).toBeGreaterThanOrEqual(2);
    expect(body.allocations.maxSharpe.label).toMatch(/simplex|need/);
    expect(body.summary.maxSharpe).toBe(body.allocations.maxSharpe.sharpe);
  });

  it("returns an empty desk on unexpected errors instead of 500 JSON", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        quantropy_runs: () => ({ data: null, error: { code: "500", message: "DB error" } }),
      })
    );
    const { GET } = await import("../quantropy/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.names)).toBe(true);
  });
});

describe("GET /api/rotate", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns lite canaries from prices_daily when rotation snapshot is missing", async () => {
    const sectors = [
      ["AAPL", "Technology", 1.004],
      ["MSFT", "Technology", 1.0035],
      ["XOM", "Energy", 1.001],
      ["JNJ", "Health Care", 1.0004],
      ["PG", "Consumer Staples", 1.0005],
      ["JPM", "Financials", 1.0015],
      ["AMZN", "Consumer Discretionary", 1.0025],
    ] as const;
    const uni = sectors.map(([symbol, sector]) => ({ symbol, sector, company_name: symbol }));
    const prices = sectors.flatMap(([symbol, , g]) => px(symbol, 220, g));
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        sector_rotation_runs: () => ({ data: [], error: null }),
        universe_members: () => ({ data: uni, error: null }),
        prices_daily: () => ({ data: prices, error: null }),
      })
    );
    const { GET } = await import("../rotate/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.lite).toBe(true);
    expect(body.canaries.length).toBeGreaterThan(0);
    expect(body.corr.labels.length).toBeGreaterThan(1);
    const qqq = body.canaries.find((c: { name: string }) => c.name === "QQQ/SPY");
    expect(qqq?.tape?.length ?? 0).toBeGreaterThan(0);
  });

  it("returns an empty desk on unexpected errors instead of 500 JSON", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        sector_rotation_runs: () => ({ data: null, error: { code: "500", message: "DB error" } }),
      })
    );
    const { GET } = await import("../rotate/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.canaries)).toBe(true);
    expect(body.error).toBeUndefined();
  });
});
