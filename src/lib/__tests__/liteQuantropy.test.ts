import { describe, expect, it } from "vitest";
import { liteQuantFromPrices } from "@/lib/liteDesks";

describe("liteQuantFromPrices", () => {
  it("does not present equal or inverse-vol weights as optimized books", () => {
    const rows = ["AAA", "BBB"].flatMap((ticker, k) =>
      Array.from({ length: 80 }, (_, i) => ({
        symbol: ticker,
        date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
        close: 100 + i * (k + 1) + (i % 3) * k,
      }))
    );
    const out = liteQuantFromPrices(rows);
    expect(out.names.length).toBe(2);
    for (const n of out.names) {
      expect(n.wEqual).toBeCloseTo(0.5);
      expect(n.wInvVol).not.toBeNull();
      expect(n.wMinVar).toBeNull();
      expect(n.wMaxSharpe).toBeNull();
    }
  });
});
