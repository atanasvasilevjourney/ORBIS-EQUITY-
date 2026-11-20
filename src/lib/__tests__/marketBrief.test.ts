import { describe, expect, it } from "vitest";
import { composeMarketBrief } from "@/lib/marketBrief";

describe("composeMarketBrief tape reconcile", () => {
  it("softens bullish label when indices are down", () => {
    const out = composeMarketBrief({
      pipelineBrief: null,
      postureLabel: "Slight Bullish",
      advancersPct: 68,
      bestSector: "Financials",
      worstSector: "Tech",
      regime: null,
      quotes: [
        { symbol: "SPY", dayPct: -1.96 },
        { symbol: "QQQ", dayPct: -2.19 },
        { symbol: "IWM", dayPct: -2.18 },
      ],
    });
    expect(out.text.toLowerCase()).toContain("bearish");
  });
});