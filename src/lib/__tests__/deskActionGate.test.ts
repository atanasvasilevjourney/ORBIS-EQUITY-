import { describe, expect, it } from "vitest";
import { gateCockpitActionable } from "@/lib/deskActionGate";
import type { CockpitDeskSummaries } from "@/lib/cockpitDeskSummaries";

const desks: CockpitDeskSummaries = {
  earningsBeats: 4,
  earningsMisses: 1,
  earningsUpcoming: 2,
  newsCount: 9,
  skewNames: 3,
  skewAtm: 0.2,
  skewWeekend: "Fri",
  orbGappers: 6,
  orbBreakouts: 2,
  analysisBuys: 5,
  analysisSells: 1,
  quantNames: 8,
  quantSharpe: 1.1,
  biasLongs: 3,
  biasShorts: 2,
  cashTema: 4,
  cashCarver: 1,
  triangleSetups: 7,
  triangleBreakouts: 2,
};

describe("gateCockpitActionable", () => {
  it("leaves counts alone when the tape is fresh", () => {
    expect(gateCockpitActionable(desks, false)).toEqual(desks);
  });

  it("zeros trade counts and keeps informational desks", () => {
    const gated = gateCockpitActionable(desks, true);
    expect(gated.analysisBuys).toBe(0);
    expect(gated.analysisSells).toBe(0);
    expect(gated.biasLongs).toBe(0);
    expect(gated.biasShorts).toBe(0);
    expect(gated.orbBreakouts).toBe(0);
    expect(gated.triangleBreakouts).toBe(0);
    expect(gated.cashTema).toBe(0);
    expect(gated.cashCarver).toBe(0);
    expect(gated.earningsBeats).toBe(4);
    expect(gated.orbGappers).toBe(6);
    expect(gated.triangleSetups).toBe(7);
    expect(gated.newsCount).toBe(9);
  });
});
