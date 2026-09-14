import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

describe("GET /api/skew", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns an empty desk when skew tables are missing", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        skew_runs: () => ({
          data: null,
          error: { code: "PGRST205", message: "Could not find the table in the schema cache" },
        }),
      })
    );

    const { GET } = await import("../skew/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.names).toEqual([]);
    expect(body.summary).toBeNull();
  });

  it("returns an empty desk on unexpected errors instead of 500 JSON", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        skew_runs: () => ({ data: null, error: { code: "500", message: "DB error" } }),
      })
    );

    const { GET } = await import("../skew/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.names)).toBe(true);
    expect(body.names).toEqual([]);
  });
});
