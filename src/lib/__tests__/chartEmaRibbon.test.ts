import { describe, expect, it } from "vitest";
import { ribbonLoHi } from "@/lib/chartEmaRibbon";

describe("ribbonLoHi", () => {
  it("uses min/max of close and high EMA", () => {
    const bands = ribbonLoHi([100, 105], [102, 104]);
    expect(bands).toEqual([{ lo: 100, hi: 102 }, { lo: 104, hi: 105 }]);
  });
});
