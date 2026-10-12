import { describe, expect, it } from "vitest";
import {
  isEodStale,
  lastExpectedEodDate,
  previousTradingDayIso,
} from "@/lib/freshness";

describe("freshness", () => {
  it("previousTradingDay skips weekends", () => {
    expect(previousTradingDayIso("2026-10-12")).toBe("2026-10-09");
  });

  it("Monday morning expects Friday bar as fresh", () => {
    const monMorning = new Date("2026-10-12T14:00:00Z");
    expect(lastExpectedEodDate(monMorning)).toBe("2026-10-09");
    expect(isEodStale("2026-10-09", monMorning)).toBe(false);
    expect(isEodStale("2026-10-08", monMorning)).toBe(false);
    expect(isEodStale("2026-10-07", monMorning)).toBe(true);
  });

  it("missing asOf is stale", () => {
    expect(isEodStale(null)).toBe(true);
  });
});
