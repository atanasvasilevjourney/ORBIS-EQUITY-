import { describe, expect, it, vi, afterEach } from "vitest";
import { optionsFlowProxy, quotesFromBars } from "@/lib/sessionQuotes";

describe("quotesFromBars", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes close-to-close day percent change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T20:00:00Z"));
    const map = quotesFromBars([
      { symbol: "MU", date: "2026-11-21", close: 100 },
      { symbol: "MU", date: "2026-11-24", close: 629.79 },
    ]);
    const q = map.get("MU");
    expect(q?.last).toBe(629.79);
    expect(q?.dayPct).toBeCloseTo(529.79, 1);
    expect(q?.asOf).toBe("2026-11-24");
  });

  it("marks options flow helper as proxy", () => {
    const proxy = optionsFlowProxy({
      last: 10,
      dayPct: 1,
      asOf: "2026-11-24",
      stale: false,
      volume: 1_000_000,
    });
    expect(proxy.isProxy).toBe(true);
    expect(proxy.value).toBe(10_000_000);
    expect(proxy.definition).toMatch(/Not listed options/i);
  });
});