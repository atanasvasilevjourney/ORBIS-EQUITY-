import { describe, expect, it } from "vitest";
import { sectorExposureFromBook } from "@/lib/loopSectorHarness";

describe("sectorExposureFromBook", () => {
  it("groups book rows by sector", () => {
    const rows = sectorExposureFromBook(
      [
        { sector: "Information Technology", shares: 100, last: 200 },
        { sector: "Information Technology", shares: 50, last: 400 },
        { sector: "Health Care", shares: 10, last: 100 },
      ],
      100_000,
      8,
      2
    );
    expect(rows).toHaveLength(2);
    const it = rows.find((r) => r.sector === "Information Technology");
    expect(it?.names).toBe(2);
    expect(it?.exposurePct).toBeCloseTo(0.4, 4);
  });
});
