import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/fundamentals/[ticker]", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns 400 for invalid ticker format", async () => {
    const { GET } = await import("../fundamentals/[ticker]/route");
    const req = new NextRequest("http://localhost/api/fundamentals/BAD!!");
    const res = await GET(req, { params: { ticker: "BAD!!" } });

    expect(res.status).toBe(400);
  });

  it("returns financial report trends", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        financial_reports: () => ({
          data: [{
            fiscal_year: 2025,
            date: "2025-12-31",
            data: {
              revenue: 100000,
              grossProfit: 40000,
              operatingIncome: 20000,
              netIncome: 15000,
              ebitda: 25000,
              epsDiluted: 5.0,
            },
          }],
          error: null,
        }),
      })
    );

    const { GET } = await import("../fundamentals/[ticker]/route");
    const req = new NextRequest("http://localhost/api/fundamentals/AAPL");
    const res = await GET(req, { params: { ticker: "AAPL" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.income).toHaveLength(1);
    expect(body.income[0].revenue).toBe(100000);
    expect(body.income[0].grossMargin).toBeCloseTo(0.4);
  });

  it("returns 500 on Supabase error", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        financial_reports: () => ({ data: null, error: { message: "fail" } }),
      })
    );

    const { GET } = await import("../fundamentals/[ticker]/route");
    const req = new NextRequest("http://localhost/api/fundamentals/AAPL");
    const res = await GET(req, { params: { ticker: "AAPL" } });

    expect(res.status).toBe(500);
  });
});
