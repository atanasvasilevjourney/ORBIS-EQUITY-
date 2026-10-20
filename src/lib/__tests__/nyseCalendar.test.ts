import { describe, expect, it } from "vitest";
import { isNyseHoliday, isNyseTradingDay } from "@/lib/nyseCalendar";

describe("nyseCalendar", () => {
  it("matches published NYSE full-day closures for 2025", () => {
    const closed = [
      "2025-01-01",
      "2025-01-20",
      "2025-02-17",
      "2025-04-18",
      "2025-05-26",
      "2025-06-19",
      "2025-07-04",
      "2025-09-01",
      "2025-11-27",
      "2025-12-25",
    ];
    for (const d of closed) expect(isNyseHoliday(d), d).toBe(true);
  });

  it("matches published NYSE full-day closures for 2026", () => {
    const closed = [
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-04-03",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03",
      "2026-09-07",
      "2026-11-26",
      "2026-12-25",
    ];
    for (const d of closed) expect(isNyseHoliday(d), d).toBe(true);
  });

  it("observes Saturday holidays on Friday but not a Saturday New Year", () => {
    expect(isNyseHoliday("2027-12-24")).toBe(true);
    expect(isNyseHoliday("2027-12-31")).toBe(false);
  });

  it("treats ordinary weekdays as sessions and weekends as closed", () => {
    expect(isNyseTradingDay("2026-10-20")).toBe(true);
    expect(isNyseTradingDay("2026-10-17")).toBe(false);
    expect(isNyseTradingDay("2026-11-26")).toBe(false);
  });
});
