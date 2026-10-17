import { describe, expect, it } from "vitest";
import { parseEma200Timeframe } from "@/lib/ema200Timeframe";

describe("parseEma200Timeframe", () => {
  it("parses weekly aliases", () => {
    expect(parseEma200Timeframe("weekly")).toBe("weekly");
    expect(parseEma200Timeframe("1w")).toBe("weekly");
    expect(parseEma200Timeframe("W")).toBe("weekly");
  });

  it("defaults to daily", () => {
    expect(parseEma200Timeframe(null)).toBe("daily");
    expect(parseEma200Timeframe("1d")).toBe("daily");
  });
});
