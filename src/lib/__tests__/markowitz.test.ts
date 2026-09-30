import { describe, expect, it } from "vitest";
import {
  listwiseReturns,
  maxSharpeWeights,
  minVarWeights,
  portfolioStats,
  projectSimplex,
  sampleCov,
  sampleMu,
} from "@/lib/markowitz";
import { liteQuantFromPrices } from "@/lib/liteDesks";

describe("simplex Markowitz", () => {
  it("projects onto the probability simplex", () => {
    const w = projectSimplex([0.8, 0.8, -0.3]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    expect(w.every((x) => x >= -1e-12)).toBe(true);
  });

  it("min-var overweights the quieter name", () => {
    const t = 80;
    const quiet = Array.from({ length: t }, () => 0.001);
    const loud = Array.from({ length: t }, (_, i) => (i % 2 === 0 ? 0.04 : -0.03));
    const cov = sampleCov([loud, quiet]);
    const w = minVarWeights(cov);
    expect(w[1]).toBeGreaterThan(w[0]);
    expect(w[0] + w[1]).toBeCloseTo(1, 6);
  });

  it("max-Sharpe prefers the higher-drift name", () => {
    const t = 80;
    const high = Array.from({ length: t }, (_, i) => 0.004 + 0.0004 * Math.sin(i));
    const low = Array.from({ length: t }, (_, i) => 0.0004 + 0.0004 * Math.cos(i));
    const mu = sampleMu([high, low]);
    const cov = sampleCov([high, low]);
    const w = maxSharpeWeights(mu, cov);
    expect(w[0]).toBeGreaterThan(w[1]);
    const stats = portfolioStats(w, mu, cov);
    expect(stats.sharpe).toBeGreaterThan(0);
  });

  it("drops rows that are not listwise finite", () => {
    const panel = listwiseReturns([
      [0.01, Number.NaN, 0.02],
      [0.01, 0.01, 0.02],
    ]);
    expect(panel[0]).toEqual([0.01, 0.02]);
    expect(panel[1]).toEqual([0.01, 0.02]);
  });
});

describe("lite QUANT books", () => {
  it("does not alias min-var / max-Sharpe to inv-vol / 1/N", () => {
    const rows = [];
    for (let i = 0; i < 80; i++) {
      const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
      rows.push({ symbol: "AAA", date: d, close: 10 * 1.004 ** i });
      rows.push({ symbol: "BBB", date: d, close: 10 * (1 + 0.08 * Math.sin(i / 3)) });
    }
    const lite = liteQuantFromPrices(rows);
    const aaa = lite.names.find((n) => n.ticker === "AAA");
    expect(aaa?.wMinVar).not.toBeNull();
    expect(aaa?.wMaxSharpe).not.toBeNull();
    expect(aaa?.wMinVar).not.toBeCloseTo(aaa?.wInvVol ?? -1, 8);
    expect(lite.allocations.maxSharpe.sharpe).not.toBeNull();
    expect(lite.headline).toMatch(/simplex/);
  });
});
