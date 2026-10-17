import { describe, expect, it } from "vitest";
import { aggregateDailyToWeekly } from "@/lib/ohlcWeekly";

describe("aggregateDailyToWeekly", () => {
  it("rolls daily bars into weekly OHLCV", () => {
    const daily = [
      { date: "2026-01-05", open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { date: "2026-01-06", open: 10.5, high: 12, low: 10, close: 11, volume: 200 },
      { date: "2026-01-12", open: 11, high: 13, low: 11, close: 12, volume: 150 },
    ];
    const weeks = aggregateDailyToWeekly(daily);
    expect(weeks.length).toBe(2);
    expect(weeks[0].open).toBe(10);
    expect(weeks[0].high).toBe(12);
    expect(weeks[0].close).toBe(11);
    expect(weeks[0].volume).toBe(300);
  });
});
