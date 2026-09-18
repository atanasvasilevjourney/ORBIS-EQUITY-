import { describe, expect, it } from "vitest";
import { quoteIsFresh, toChartTime } from "@/lib/lseLive";

describe("toChartTime", () => {
  it("keeps daily YYYY-MM-DD", () => {
    expect(toChartTime("2026-09-18")).toBe("2026-09-18");
  });

  it("converts ISO timestamps to unix seconds", () => {
    expect(toChartTime("2026-09-18T12:45:00Z")).toBe(Date.parse("2026-09-18T12:45:00Z") / 1000);
  });

  it("divides millisecond unix stamps", () => {
    expect(toChartTime(1_726_000_000_000)).toBe(1_726_000_000);
  });
});

describe("quoteIsFresh", () => {
  it("is true inside 45s", () => {
    expect(quoteIsFresh(new Date().toISOString())).toBe(true);
  });

  it("is false when stale", () => {
    expect(quoteIsFresh(new Date(Date.now() - 60_000).toISOString())).toBe(false);
    expect(quoteIsFresh(null)).toBe(false);
  });
});
