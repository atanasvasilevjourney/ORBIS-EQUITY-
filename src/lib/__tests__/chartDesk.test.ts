import { describe, expect, it } from "vitest";
import { chartHref, playScanTimeframe } from "@/lib/chartDesk";

describe("chartHref", () => {
  it("opens the CHART module for a ticker", () => {
    expect(chartHref("aapl")).toBe("/chart/AAPL");
  });

  it("carries PLAY timeframe and origin", () => {
    expect(chartHref("META", { tf: "5m", from: "play" })).toBe("/chart/META?tf=5m&from=play");
  });

  it("falls back to the empty chart desk", () => {
    expect(chartHref("  ")).toBe("/chart");
  });
});

describe("playScanTimeframe", () => {
  it("uses 5m for overnight and 5m-breakout scans", () => {
    expect(playScanTimeframe("overnight")).toBe("5m");
    expect(playScanTimeframe("breakout5m")).toBe("5m");
    expect(playScanTimeframe("breakout")).toBe("1d");
    expect(playScanTimeframe("gainers")).toBe("1d");
  });
});
