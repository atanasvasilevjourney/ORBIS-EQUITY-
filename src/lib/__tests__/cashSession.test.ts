import { describe, expect, it } from "vitest";
import { cashClock, overnightWatchStep } from "@/lib/cashSession";

describe("cashClock", () => {
  it("is PREMARKET at 07:00 ET on a weekday", () => {
    // 2026-09-18 07:00 America/New_York = 11:00 UTC (EDT)
    const c = cashClock(Date.parse("2026-09-18T11:00:00Z"));
    expect(c.phase).toBe("PREMARKET");
    expect(c.et).toBe("07:00 ET");
    expect(c.minsToOpen).toBe(150);
    expect(c.watchOvernight).toBe(true);
    expect(overnightWatchStep(c)).toBe(1);
  });

  it("locks names at 09:25 ET then marks OR after 09:30", () => {
    const lock = cashClock(Date.parse("2026-09-18T13:25:00Z"));
    expect(lock.phase).toBe("PREMARKET");
    expect(overnightWatchStep(lock)).toBe(2);
    const orWin = cashClock(Date.parse("2026-09-18T13:35:00Z"));
    expect(orWin.phase).toBe("REGULAR");
    expect(overnightWatchStep(orWin)).toBe(3);
    const trigger = cashClock(Date.parse("2026-09-18T13:46:00Z"));
    expect(overnightWatchStep(trigger)).toBe(4);
  });

  it("is WEEKEND on Saturday", () => {
    const c = cashClock(Date.parse("2026-09-19T11:00:00Z"));
    expect(c.phase).toBe("WEEKEND");
    expect(c.watchOvernight).toBe(false);
  });
});
