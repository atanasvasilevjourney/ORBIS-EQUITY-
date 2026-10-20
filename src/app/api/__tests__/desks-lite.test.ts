import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => mockCreateServerClient(),
}));

vi.mock("@/lib/liteDeskGate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/liteDeskGate")>();
  return {
    ...orig,
    deskFreshnessForLite: async () => ({
      stale: false,
      signalsSuppressed: false,
      expectedEodDate: "2026-10-12",
      minFreshDate: "2026-10-09",
      asOfDate: null,
    }),
  };
});

describe("GET /api/quantropy", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateServerClient.mockReset();
  });

  it("returns empty desk when there is no snapshot (no lite recompute)", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        quantropy_runs: () => ({ data: [], error: null }),
        prices_daily: () => ({ data: [], error: null }),
      })
    );
    const { GET } = await import("../quantropy/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.lite).toBe(false);
    expect(body.names).toEqual([]);
    expect(body.headline).toMatch(/pending|unavailable/i);
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

  it("returns empty desk when rotation snapshot is missing (no lite recompute)", async () => {
    mockCreateServerClient.mockReturnValue(
      createMockSupabase({
        sector_rotation_runs: () => ({ data: [], error: null }),
        prices_daily: () => ({ data: [], error: null }),
      })
    );
    const { GET } = await import("../rotate/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.lite).toBe(false);
    expect(body.canaries).toEqual([]);
    expect(body.headline).toMatch(/pending|unavailable/i);
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
