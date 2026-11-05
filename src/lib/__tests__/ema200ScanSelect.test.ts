import { describe, expect, it } from "vitest";
import { selectScanUniverse } from "@/lib/ema200ScanSelect";

describe("selectScanUniverse", () => {
  it("keeps names whose last bar is a session behind the newest print", () => {
    const { asOfDate, latest } = selectScanUniverse([
      { symbol: "AMZN", bar_date: "2026-10-10" },
      { symbol: "MSFT", bar_date: "2026-10-09" },
      { symbol: "AAPL", bar_date: "2026-10-10" },
    ]);
    expect(asOfDate).toBe("2026-10-10");
    expect(latest.map((r) => r.symbol).sort()).toEqual(["AAPL", "AMZN", "MSFT"]);
  });

  it("ignores a stray future bar that would otherwise blank the book", () => {
    const { asOfDate, latest } = selectScanUniverse([
      { symbol: "AMZN", bar_date: "2026-10-10" },
      { symbol: "MSFT", bar_date: "2026-10-10" },
      { symbol: "BAD", bar_date: "2099-01-01" },
    ]);
    expect(asOfDate).toBe("2026-10-10");
    expect(latest.map((r) => r.symbol).sort()).toEqual(["AMZN", "MSFT"]);
  });

  it("uses each symbol's newest row", () => {
    const { latest } = selectScanUniverse([
      { symbol: "AMZN", bar_date: "2026-10-08", close: 1 },
      { symbol: "AMZN", bar_date: "2026-10-10", close: 2 },
    ]);
    expect(latest).toHaveLength(1);
    expect(latest[0].close).toBe(2);
  });
});
