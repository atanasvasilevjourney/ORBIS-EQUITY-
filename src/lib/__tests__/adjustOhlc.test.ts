import { describe, expect, it } from "vitest";
import { scaleOhlc } from "@/lib/adjustOhlc";
import { dropOpenCashSession } from "@/lib/cashSession";

describe("scaleOhlc", () => {
  it("scales high and low with the adjusted close", () => {
    const scaled = scaleOhlc({ open: 400, high: 420, low: 390, close: 400 }, 100);
    expect(scaled.close).toBe(100);
    expect(scaled.high).toBeCloseTo(105);
    expect(scaled.low).toBeCloseTo(97.5);
    expect(scaled.open).toBe(100);
  });

  it("leaves an already-adjusted bar unchanged", () => {
    const scaled = scaleOhlc({ open: 10, high: 11, low: 9, close: 10 }, 10);
    expect(scaled).toEqual({ open: 10, high: 11, low: 9, close: 10 });
  });
});

describe("dropOpenCashSession", () => {
  it("drops today's bar before the NYSE close", () => {
    const now = new Date("2026-11-05T14:00:00Z"); // 09:00 ET
    const bars = [
      { date: "2026-11-04", close: 1 },
      { date: "2026-11-05", close: 2 },
    ];
    expect(dropOpenCashSession(bars, now).map((b) => b.date)).toEqual(["2026-11-04"]);
  });

  it("keeps today's bar after the close", () => {
    const now = new Date("2026-11-05T21:30:00Z"); // 16:30 ET
    const bars = [
      { date: "2026-11-04", close: 1 },
      { date: "2026-11-05", close: 2 },
    ];
    expect(dropOpenCashSession(bars, now)).toHaveLength(2);
  });
});