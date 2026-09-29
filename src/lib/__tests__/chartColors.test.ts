import { describe, expect, it } from "vitest";
import { withAlpha } from "@/lib/chartColors";

describe("withAlpha", () => {
  it("converts neon bull hex to rgba for volume histograms", () => {
    expect(withAlpha("#00ff88", 0.35)).toBe("rgba(0, 255, 136, 0.35)");
  });

  it("does not produce invalid 9-char hex like #00ff8855", () => {
    const bad = "#00ff88" + "55";
    expect(bad).toBe("#00ff8855");
    expect(withAlpha("#00ff88", 0.35)).not.toContain("8855");
  });
});
