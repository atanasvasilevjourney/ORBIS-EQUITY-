import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateServerClient = vi.fn();
const sparkMock = vi.hoisted(() => vi.fn(async () => [] as unknown[]));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

vi.mock("@/lib/yahooSpark", () => ({
  fetchYahooSpark: sparkMock,
}));

type Row = Record<string, unknown>;

function createFilterMock(tables: Record<string, Row[]>) {
  return {
    from: (table: string) => {
      const rows = tables[table] ?? [];
      const state = {
        eq: [] as [string, unknown][],
        lt: [] as [string, unknown][],
        orderCol: null as string | null,
        ascending: true,
        limitN: null as number | null,
        rangeFrom: 0,
        rangeTo: undefined as number | undefined,
      };
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (k: string, v: unknown) => {
        state.eq.push([k, v]);
        return chain;
      };
      chain.lt = (k: string, v: unknown) => {
        state.lt.push([k, v]);
        return chain;
      };
      chain.order = (k: string, opts?: { ascending?: boolean }) => {
        state.orderCol = k;
        state.ascending = opts?.ascending !== false;
        return chain;
      };
      chain.limit = (n: number) => {
        state.limitN = n;
        return chain;
      };
      chain.range = (from: number, to: number) => {
        state.rangeFrom = from;
        state.rangeTo = to;
        return chain;
      };
      chain.then = (
        onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        let out = rows.filter((r) => {
          for (let i = 0; i < state.eq.length; i++) {
            const [k, v] = state.eq[i];
            if (r[k] !== v) return false;
          }
          for (let i = 0; i < state.lt.length; i++) {
            const [k, v] = state.lt[i];
            if (!(String(r[k]) < String(v))) return false;
          }
          return true;
        });
        if (state.orderCol) {
          const col = state.orderCol;
          const dir = state.ascending ? 1 : -1;
          out = [...out].sort((a, b) => {
            const av = String(a[col] ?? "");
            const bv = String(b[col] ?? "");
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
          });
        }
        if (state.limitN != null) out = out.slice(0, state.limitN);
        if (state.rangeTo != null) out = out.slice(state.rangeFrom, state.rangeTo + 1);
        return Promise.resolve({ data: out, error: null }).then(onFulfilled, onRejected);
      };
      return chain;
    },
  };
}

const AS_OF = "2026-09-16";
const PRIOR = "2026-09-15";

function bar(symbol: string, date: string, o: number, h: number, l: number, c: number, volume: number) {
  return { symbol, date, open: o, high: h, low: l, close: c, volume };
}

const PRICES = [
  bar("RXT", PRIOR, 0.4, 0.45, 0.39, 0.42, 1_000_000),
  bar("RXT", AS_OF, 0.42, 1.14, 0.42, 0.9956, 32_000_000),
  bar("SNSE", PRIOR, 9, 10, 8.8, 10, 100_000),
  bar("SNSE", AS_OF, 11, 12.5, 10.8, 12, 200_000),
  bar("DOWN", PRIOR, 10, 10.2, 9.8, 10, 50_000),
  bar("DOWN", AS_OF, 9.5, 9.6, 7.8, 8, 40_000),
  bar("GAP", PRIOR, 10, 10.2, 9.9, 10, 10_000),
  bar("GAP", AS_OF, 10.5, 11, 10.4, 10.6, 12_000),
  bar("NEW", AS_OF, 1, 1, 1, 1, 1),
];

const UNI = [
  { symbol: "RXT", company_name: "Rackspace Technology, Inc.", is_active: true },
  { symbol: "SNSE", company_name: "Sensei Biotherapeutics", is_active: true },
  { symbol: "DOWN", company_name: "Decliner Co", is_active: true },
  { symbol: "GAP", company_name: "Gap Name", is_active: true },
];

describe("GET /api/play", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
    sparkMock.mockReset();
    sparkMock.mockResolvedValue([]);
  });

  it("ranks last-session gainers from two daily prints", async () => {
    mockCreateServerClient.mockReturnValue(
      createFilterMock({
        prices_daily: PRICES,
        universe_members: UNI,
      })
    );
    const { GET } = await import("../play/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.summary.asOfDate).toBe(AS_OF);
    expect(body.summary.priorDate).toBe(PRIOR);
    expect(body.gainers[0].ticker).toBe("RXT");
    expect(body.gainers[0].companyName).toContain("Rackspace");
    expect(body.gainers[0].chgPct).toBeCloseTo(0.9956 / 0.42 - 1, 6);
    expect(body.losers[0].ticker).toBe("DOWN");
    expect(body.gappers.some((r: { ticker: string }) => r.ticker === "GAP")).toBe(true);
    expect(body.liquid[0].ticker).toBe("RXT");
    expect(body.headline).toContain("RXT");
    expect(body.gainers.every((r: { ticker: string }) => r.ticker !== "NEW")).toBe(true);
    expect(body.overnight).toEqual([]);
    expect(body.clock).toBeTruthy();
  });

  it("ranks delayed overnight gap-ups from Yahoo spark", async () => {
    sparkMock.mockResolvedValue([
      {
        symbol: "RXT",
        response: [
          {
            meta: { symbol: "RXT", chartPreviousClose: 0.42, regularMarketPrice: 0.9 },
            timestamp: [1, 2],
            indicators: {
              quote: [{ open: [0.5, 0.88], high: [0.6, 0.95], low: [0.45, 0.8], close: [0.55, 0.9], volume: [10, 20] }],
            },
          },
        ],
      },
    ]);
    mockCreateServerClient.mockReturnValue(
      createFilterMock({
        prices_daily: PRICES,
        universe_members: UNI,
      })
    );
    const { GET } = await import("../play/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.overnight[0].ticker).toBe("RXT");
    expect(body.overnight[0].gapPct).toBeCloseTo(0.9 / 0.42 - 1, 6);
    expect(body.overnight[0].orbEligible).toBe(true);
    expect(body.summary.overnightLead).toBe("RXT");
    expect(body.headline).toContain("RXT");
  });

  it("returns an empty desk when prices_daily has no dates", async () => {
    mockCreateServerClient.mockReturnValue(createFilterMock({ prices_daily: [], universe_members: [] }));
    const { GET } = await import("../play/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.gainers).toEqual([]);
    expect(body.stale).toBe(true);
  });

  it("returns an empty desk on unexpected errors instead of 500 JSON", async () => {
    mockCreateServerClient.mockImplementation(() => {
      throw new Error("no supabase");
    });
    const { GET } = await import("../play/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.gainers).toEqual([]);
    expect(body.headline).toBe("Play desk unavailable");
  });
});
