import { describe, expect, it } from "vitest";
import { sectorLeadersFromSession, type RadarDayRow } from "@/lib/liveBreadth";
import type { SessionQuote } from "@/lib/sessionQuotes";

describe("sectorLeadersFromSession", () => {
  it("ranks sectors by average session return, not stale radar", () => {
    const radar: RadarDayRow[] = [
      { symbol: "A", z_mom: -5 },
      { symbol: "B", z_mom: -4 },
      { symbol: "C", z_mom: 10 },
    ];
    const quotes = new Map<string, SessionQuote>([
      ["A", { last: 1, dayPct: 2, asOf: "2026-11-24", stale: false, volume: 1 }],
      ["B", { last: 1, dayPct: 1.5, asOf: "2026-11-24", stale: false, volume: 1 }],
      ["C", { last: 1, dayPct: -3, asOf: "2026-11-24", stale: false, volume: 1 }],
    ]);
    const sectors = new Map([
      ["A", "Consumer Discretionary"],
      ["B", "Consumer Discretionary"],
      ["C", "Energy"],
    ]);
    const out = sectorLeadersFromSession(radar, quotes, sectors);
    expect(out.bestSector).toBe("Consumer Discretionary");
    expect(out.worstSector).toBe("Energy");
    expect(out.sectors.find((s) => s.sector === "Consumer Discretionary")?.advancersPct).toBe(100);
  });
});