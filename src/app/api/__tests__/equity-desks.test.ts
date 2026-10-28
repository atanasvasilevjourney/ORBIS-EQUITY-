import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase";
import { lastExpectedEodDate } from "@/lib/freshness";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

vi.mock("@/lib/liteDeskApi", () => ({
  fetchLitePrices: async () => [
    { symbol: "SPY", date: "2026-10-23", close: 500 },
    { symbol: "SPY", date: "2026-10-26", close: 505 },
  ],
  LIQUID_NAMES: ["AAPL", "MSFT", "NVDA", "AMZN"],
}));

vi.mock("@/lib/cockpitDeskSummaries", () => ({
  fetchCockpitDeskSummaries: async () => ({
    earningsBeats: 1,
    earningsMisses: 0,
    earningsUpcoming: 2,
    newsCount: 3,
    skewNames: 0,
    skewAtm: null,
    skewWeekend: null,
    orbGappers: 0,
    orbBreakouts: 0,
    analysisBuys: 0,
    analysisSells: 0,
    quantNames: 0,
    quantSharpe: null,
    biasLongs: 0,
    biasShorts: 0,
    cashTema: 0,
    cashCarver: 0,
    triangleSetups: 0,
    triangleBreakouts: 0,
  }),
}));

const asOf = lastExpectedEodDate();

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("keeps Health Care names and drops other sectors", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        universe_members: () => ({
          data: [
            {
              symbol: "UNH",
              company_name: "UnitedHealth",
              sector: "Health Care",
              industry: "Managed Care",
              country: "US",
              exchange: "NYSE",
            },
            {
              symbol: "AAPL",
              company_name: "Apple",
              sector: "Technology",
              industry: "Hardware",
              country: "US",
              exchange: "NASDAQ",
            },
          ],
          error: null,
        }),
        fundamentals_snapshot: () => ({
          data: [{ symbol: "UNH", price: 500, composite_factor_score: 72, f_score: 7 }],
          error: null,
        }),
        trend_radar: () => ({
          data: [{ symbol: "UNH", state: 1, quality_rank: 80 }],
          error: null,
        }),
      })
    );

    const { GET } = await import("../health/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary.healthNames).toBe(1);
    expect(body.rows[0].symbol).toBe("UNH");
    expect(body.rows[0].compositeScore).toBe(72);
    expect(body.rows[0].rank).toBe(80);
  });

  it("returns 500 when the client cannot be built", async () => {
    mockCreateServerClient.mockImplementation(() => {
      throw new Error("missing service key");
    });
    const { GET } = await import("../health/route");
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});

describe("GET /api/status", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("rolls the latest pipeline run into module status", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        prices_daily: () => ({ data: [{ date: asOf }], error: null }),
        daily_brief: () => ({ data: [{ asof_date: asOf }], error: null }),
        paper_loop_runs: () => ({ data: [{ asof_date: asOf }], error: null }),
        pipeline_runs: () => ({
          data: [
            {
              run_id: "run-1",
              source: "compute.portfolio_loop",
              status: "ok",
              row_counts: { names: 3 },
              asof_date: asOf,
              started_at: `${asOf}T21:00:00Z`,
              finished_at: `${asOf}T21:05:00Z`,
              headline: "loop ok",
              error: null,
            },
          ],
          error: null,
        }),
        ingest_runs: () => ({ data: [], error: null }),
        triangle_scan_runs: () => ({
          data: [{ asof_date: asOf, names: 4, headline: "4 setups" }],
          error: null,
        }),
      })
    );
    const { GET } = await import("../status/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pricesAsOf).toBe(asOf);
    expect(body.loopAsOf).toBe(asOf);
    expect(body.modules[0].source).toBe("compute.portfolio_loop");
    expect(body.triangleDesk.migrationApplied).toBe(true);
    expect(body.triangleDesk.names).toBe(4);
  });

  it("returns 500 when the status client throws", async () => {
    mockCreateServerClient.mockImplementation(() => {
      throw new Error("down");
    });
    const { GET } = await import("../status/route");
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("GET /api/loop", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns an empty desk when the paper book has never run", async () => {
    mockCreateServerClient.mockReturnValue(createMockSupabase({}));
    const { GET } = await import("../loop/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.summary).toBeNull();
    expect(body.book).toEqual([]);
    expect(body.stale).toBe(true);
    expect(body.journalSummary.closedTrades).toBe(0);
  });

  it("returns the Donchian book, a candidate, and the XS sleeve", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        paper_loop_runs: () => ({
          data: [
            {
              run_id: "loop-1",
              asof_date: asOf,
              equity: 100000,
              deployed_pct: 0.5,
              open_risk_pct: 0.02,
              names: 1,
              posture: 62,
              status: "ok",
              headline: "1 name",
              harness: { sectorExposure: [], skipped: [], config: { maxNames: 8, maxPerSector: 2 } },
              log: [{ at: asOf, level: "INFO", message: "start" }],
              computed_at: `${asOf}T21:00:00Z`,
            },
          ],
          error: null,
        }),
        paper_book: () => ({
          data: [
            {
              symbol: "AAPL",
              company_name: "Apple",
              side: "LONG",
              shares: 10,
              entry: 180,
              last: 190,
              stop: 170,
              n: 1,
              risk_usd: 100,
              sector: "Technology",
              reason: "Donchian",
              rank: 80,
              breakout: true,
              green: true,
              unrealized_pnl_usd: 100,
              days_held: 4,
              opened_at: asOf,
            },
          ],
          error: null,
        }),
        paper_orders: () => ({ data: [], error: null }),
        trading_journal: () => ({ data: [], error: null }),
        prices_daily: () => ({
          data: [
            { symbol: "AAPL", date: asOf, close: 190, adj_close: 190 },
          ],
          error: null,
        }),
        strategy_signals: () => ({
          data: [
            {
              strategy_id: "donchian_vwap",
              symbol: "MSFT",
              as_of: asOf,
              known_on: asOf,
              side: "BUY",
              score: 1.4,
              stop: null,
              size_hint: null,
              reason: "close > donchian",
            },
          ],
          error: null,
        }),
        paper_loop_xs_runs: () => ({
          data: [
            {
              run_id: "xs-1",
              asof_date: asOf,
              equity: 100000,
              deployed_pct: 0.25,
              open_risk_pct: 0.25,
              names: 1,
              posture: 62,
              status: "ok",
              headline: "XS book",
              harness: { config: { rsLookback: 63, rsCoverage: 12 } },
              log: [],
              computed_at: `${asOf}T21:05:00Z`,
            },
          ],
          error: null,
        }),
        paper_book_xs: () => ({
          data: [
            {
              symbol: "NVDA",
              company_name: "NVIDIA",
              side: "LONG",
              shares: 5,
              entry: 100,
              last: 110,
              stop: null,
              n: 88,
              risk_usd: null,
              sector: "Technology",
              reason: "Sector RS 88 · +4% day",
              rank: 70,
              breakout: null,
              green: null,
              unrealized_pnl_usd: 50,
              days_held: 3,
              opened_at: asOf,
            },
          ],
          error: null,
        }),
      })
    );

    const { GET } = await import("../loop/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary.runId).toBe("loop-1");
    expect(body.book[0].ticker).toBe("AAPL");
    expect(body.strategy.donchianVwap.entryCandidates.map((row: { symbol: string }) => row.symbol)).toContain(
      "MSFT"
    );
    expect(body.xs.summary.runId).toBe("xs-1");
    expect(body.xs.book[0].ticker).toBe("NVDA");
    expect(body.xs.book[0].reason).toMatch(/Sector RS 88/);
    expect(body.xs.book[0].rsPct).toBe(88);
    expect(body.xs.harness.config.rsLookback).toBe(63);
  });

  it("returns 500 when the loop client throws", async () => {
    mockCreateServerClient.mockImplementation(() => {
      throw new Error("down");
    });
    const { GET } = await import("../loop/route");
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("GET /api/orb", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns an empty opening-range desk before the first run", async () => {
    mockCreateServerClient.mockReturnValue(createMockSupabase({}));
    const { GET } = await import("../orb/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.summary).toBeNull();
    expect(body.watch).toEqual([]);
    expect(body.stale).toBe(true);
  });

  it("returns a gapped name on the latest session", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        orb_runs: () => ({
          data: [
            {
              run_id: "orb-1",
              asof_date: asOf,
              session_date: asOf,
              names: 1,
              breakouts: 1,
              headline: "1 breakout",
              computed_at: `${asOf}T14:00:00Z`,
            },
          ],
          error: null,
        }),
        orb_watch: () => ({
          data: [
            {
              symbol: "TSLA",
              run_id: "orb-1",
              company_name: "Tesla",
              gap_pct: 0.05,
              prev_close: 200,
              open_px: 210,
              or_high: 212,
              or_low: 208,
              or_range: 4,
              status: "BREAKOUT",
              entry: 212,
              stop: 208,
              take_profit: 216,
              shares: 10,
              breakout_at: `${asOf}T13:50:00Z`,
              last_px: 214,
              r_multiple: 0.5,
              bars: [],
            },
          ],
          error: null,
        }),
        orb_orders: () => ({ data: [], error: null }),
      })
    );
    const { GET } = await import("../orb/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.summary.runId).toBe("orb-1");
    expect(body.watch[0].ticker).toBe("TSLA");
    expect(body.watch[0].status).toBe("BREAKOUT");
  });

  it("degrades to an empty desk when the client throws", async () => {
    mockCreateServerClient.mockImplementation(() => {
      throw new Error("down");
    });
    const { GET } = await import("../orb/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.summary).toBeNull();
    expect(body.watch).toEqual([]);
  });
});

describe("GET /api/dashboard", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("builds breadth and capital from the latest brief", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        daily_brief: () => ({
          data: {
            asof_date: asOf,
            brief: "Risk-on tape",
            inputs: {
              posture_score: 64,
              posture_label: "Risk-On",
              breadth: { best_sector: "Technology", worst_sector: "Energy" },
              region_breadth: { US: 60 },
            },
          },
          error: null,
        }),
        trend_radar: () => ({
          data: [
            { symbol: "AAPL", state: 1, quality_rank: 80, z_mom: 1.2 },
            { symbol: "XOM", state: -1, quality_rank: 20, z_mom: -0.4 },
          ],
          error: null,
        }),
        fundamentals_snapshot: () => ({
          data: [{ composite_factor_score: 70, f_score: 8 }],
          error: null,
        }),
        sector_rotation_runs: () => ({ data: [], error: null }),
      })
    );
    const { GET } = await import("../dashboard/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.breadth.total).toBe(2);
    expect(body.breadth.greens).toBe(1);
    expect(body.watchlistMovers[0].symbol).toBe("AAPL");
    expect(body.bestSector).toBe("Technology");
    expect(body.crossAsset[0].symbol).toBe("SPY");
    expect(body.capital.sleeves).toHaveLength(4);
  });

  it("returns 500 when the dashboard client throws", async () => {
    mockCreateServerClient.mockImplementation(() => {
      throw new Error("down");
    });
    const { GET } = await import("../dashboard/route");
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
