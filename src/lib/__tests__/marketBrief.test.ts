import { describe, expect, it } from "vitest";
import { composeMarketBrief } from "@/lib/marketBrief";

describe("market brief", () => {
  it("keeps the pipeline sentence and appends the session tape", () => {
    const brief = composeMarketBrief({
      pipelineBrief: "Risk-On — 62% of names up, led by Technology",
      postureLabel: "Risk-On",
      advancersPct: 62,
      bestSector: "Technology",
      worstSector: "Energy",
      regime: "RISK-ON",
      quotes: [
        { symbol: "SPY", dayPct: 0.42 },
        { symbol: "QQQ", dayPct: -3.59 },
        { symbol: "IWM", dayPct: -1.94 },
      ],
    });
    expect(brief.source).toBe("mixed");
    expect(brief.text.startsWith("Risk-On — 62% of names up, led by Technology. Session tape:")).toBe(true);
    expect(brief.text).toContain("SPY +0.42%");
    expect(brief.text).toContain("QQQ -3.59%");
    expect(brief.text).toContain("small caps leading");
  });

  it("writes a tape brief when the desk has not published one", () => {
    const brief = composeMarketBrief({
      pipelineBrief: null,
      postureLabel: null,
      advancersPct: null,
      bestSector: null,
      worstSector: null,
      regime: null,
      quotes: [
        { symbol: "QQQ", dayPct: 1.2 },
        { symbol: "IWM", dayPct: 0.1 },
      ],
    });
    expect(brief.source).toBe("tape");
    expect(brief.text).toContain("QQQ +1.20%");
    expect(brief.text).toContain("large caps leading");
    expect(brief.text).not.toContain("SPY");
  });

  it("stays empty when there is nothing to report", () => {
    const brief = composeMarketBrief({
      pipelineBrief: "  ",
      postureLabel: null,
      advancersPct: null,
      bestSector: null,
      worstSector: null,
      regime: null,
      quotes: [],
    });
    expect(brief.text).toBe("");
    expect(brief.source).toBe("tape");
  });
});
