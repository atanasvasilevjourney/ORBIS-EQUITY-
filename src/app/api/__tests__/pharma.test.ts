import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/pharma", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns pharma signals with summary stats", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        pharma_signals: () => ({
          data: [
            {
              id: 1,
              ticker: "PFE",
              nct_id: "NCT001",
              event_type: "RESULTS_POSTED",
              direction: "LONG",
              phase: "PHASE3",
              confidence: 80,
              days_to_catalyst: 30,
              detected_at: "2026-01-01",
              pharma_trials: {
                drug_name: "DrugX",
                condition: "Cancer",
                overall_status: "COMPLETED",
                lead_sponsor: "Pfizer",
                start_date: "2024-01-01",
                completion_date: "2026-03-01",
                results_posted: true,
              },
            },
            {
              id: 2,
              ticker: "MRNA",
              nct_id: "NCT002",
              event_type: "TRIAL_FAILURE",
              direction: "SHORT",
              phase: "PHASE2",
              confidence: 50,
              days_to_catalyst: null,
              detected_at: "2026-01-01",
              pharma_trials: null,
            },
          ],
          error: null,
        }),
      })
    );

    const { GET } = await import("../pharma/route");
    const req = new NextRequest("http://localhost/api/pharma");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0].drugName).toBe("DrugX");
    expect(body.summary.long).toBe(1);
    expect(body.summary.short).toBe(1);
  });

  it("returns 400 for invalid ticker param", async () => {
    const { GET } = await import("../pharma/route");
    const req = new NextRequest("http://localhost/api/pharma?ticker=INVALID!!");
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it("returns 500 on Supabase error", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        pharma_signals: () => ({ data: null, error: { message: "fail" } }),
      })
    );

    const { GET } = await import("../pharma/route");
    const req = new NextRequest("http://localhost/api/pharma");
    const res = await GET(req);

    expect(res.status).toBe(500);
  });
});
