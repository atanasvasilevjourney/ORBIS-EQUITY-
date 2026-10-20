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

  it("previousTradingDay skips exchange holidays", () => {
    expect(previousTradingDayIso("2025-11-28")).toBe("2025-11-26");
    expect(previousTradingDayIso("2026-04-06")).toBe("2026-04-02");
  });

  it("Friday after Thanksgiving does not suppress the Wednesday bar", () => {
    const fridayEvening = new Date("2025-11-28T22:00:00Z");
    expect(lastExpectedEodDate(fridayEvening)).toBe("2025-11-28");
    expect(isEodStale("2025-11-26", fridayEvening)).toBe(false);
    expect(isEodStale("2025-11-24", fridayEvening)).toBe(true);
  });

  it("a holiday Monday expects the prior Friday bar", () => {
    const holidayMonday = new Date("2026-01-19T20:00:00Z");
    expect(lastExpectedEodDate(holidayMonday)).toBe("2026-01-16");
  });

  it("missing asOf is stale", () => {
    expect(isEodStale(null)).toBe(true);
  });
});
