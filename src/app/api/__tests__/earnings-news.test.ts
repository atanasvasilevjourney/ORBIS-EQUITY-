import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/earnings-news", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns earnings and news with summary", async () => {
    const today = new Date();
    const recentDate = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const futureDate = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        earnings_calendar: () => ({
          data: [
            {
              ticker: "AAPL",
              event_date: recentDate,
              confirmed: true,
              eps_est: 1.5,
              eps_actual: 1.6,
              surprise_pct: 6.7,
              revenue_est: 90000000000,
              revenue_actual: 91000000000,
            },
            {
              ticker: "MSFT",
              event_date: futureDate,
              confirmed: false,
              eps_est: 2.0,
              eps_actual: null,
              surprise_pct: null,
              revenue_est: null,
              revenue_actual: null,
            },
          ],
          error: null,
        }),
        news_items: () => ({
          data: [{
            id: 1,
            ticker: "AAPL",
            published_at: new Date().toISOString(),
            source: "Reuters",
            headline: "Apple beats estimates",
            url: "https://example.com",
            tone: "positive",
            badge: "earnings",
          }],
          error: null,
        }),
      })
    );

    const { GET } = await import("../earnings-news/route");
    const req = new NextRequest("http://localhost/api/earnings-news");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.earnings.length).toBeGreaterThan(0);
    expect(body.news).toHaveLength(1);
    expect(body.summary.totalNews).toBe(1);
  });

  it("returns 400 for invalid ticker param", async () => {
    const { GET } = await import("../earnings-news/route");
    const req = new NextRequest("http://localhost/api/earnings-news?ticker=BAD!!");
    const res = await GET(req);

    expect(res.status).toBe(400);
  });
});
