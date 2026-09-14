import { describe, expect, it } from "vitest";
import { fetchAll } from "@/lib/supabase/paginate";
import { isMissingColumn, isMissingRelation } from "@/lib/supabase/errors";
import { createMockSupabase } from "@/app/api/__tests__/helpers/mockSupabase";

describe("schema-drift errors", () => {
  it("detects missing tables and columns", () => {
    expect(isMissingRelation({ code: "PGRST205", message: "table not in schema cache" })).toBe(true);
    expect(isMissingRelation({ code: "42P01", message: "relation skew_runs does not exist" })).toBe(true);
    expect(isMissingColumn({ code: "42703", message: "column trend_radar.kama_regime does not exist" })).toBe(true);
    expect(isMissingRelation({ code: "42703", message: "column trend_radar.kama_regime does not exist" })).toBe(false);
    expect(isMissingRelation({ code: "500", message: "DB error" })).toBe(false);
  });

  it("fetchAll returns [] when the table is missing", async () => {
    const sb = createMockSupabase({
      skew_runs: () => ({
        data: null,
        error: { code: "PGRST205", message: "Could not find the table in the schema cache" },
      }),
    });
    await expect(fetchAll(sb as never, "skew_runs", "run_id")).resolves.toEqual([]);
  });

  it("fetchAll still throws unexpected errors", async () => {
    const sb = createMockSupabase({
      skew_runs: () => ({ data: null, error: { code: "500", message: "DB error" } }),
    });
    await expect(fetchAll(sb as never, "skew_runs", "run_id")).rejects.toMatchObject({ message: "DB error" });
  });
});
