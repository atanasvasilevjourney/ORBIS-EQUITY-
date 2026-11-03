import { describe, expect, it } from "vitest";
import {
  addHolding,
  applyFrontier,
  buildSnapshot,
  compareSleeves,
  cagr,
  diagnose,
  equalize,
  fixSum,
  frontierAtVol,
  getMarket,
  layoutTreemap,
  projectMonteCarlo,
  rebalanceHolding,
  removeHolding,
  sampleFrontier,
  sleeveHoldings,
  tradingDays,
} from "@/lib/portfolio/engine";
import { CASH, DEFAULT_HOLDINGS } from "@/lib/portfolio/universe";

describe("portfolio studio engine", () => {
  it("builds a weekday sample that does not depend on the clock", () => {
    const days = tradingDays("2020-01-02", "2020-01-15");
    expect(days[0]).toBe("2020-01-02");
    expect(days).not.toContain("2020-01-04");
    expect(days).not.toContain("2020-01-05");
    for (const d of days) {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      expect(dow).not.toBe(0);
      expect(dow).not.toBe(6);
    }
    const market = getMarket();
    expect(market.dates.length).toBeGreaterThan(1600);
    expect(market.dates[0] < market.dates[market.dates.length - 1]).toBe(true);
    expect(getMarket().dates.length).toBe(market.dates.length);
  });

  it("keeps basket weights on 100", () => {
    expect(fixSum(DEFAULT_HOLDINGS).reduce((s, h) => s + h.weight, 0)).toBeCloseTo(100, 5);
    const moved = rebalanceHolding(DEFAULT_HOLDINGS, "NVDA", 25);
    expect(moved.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(100, 5);
    expect(moved.find((h) => h.symbol === "NVDA")?.weight).toBeCloseTo(25, 0);
    const equal = equalize(DEFAULT_HOLDINGS);
    expect(equal.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(100, 5);
    const added = addHolding(DEFAULT_HOLDINGS, "COST", 5);
    expect(added.some((h) => h.symbol === "COST")).toBe(true);
    expect(added.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(100, 5);
    const removed = removeHolding(added, "COST");
    expect(removed.some((h) => h.symbol === "COST")).toBe(false);
    const only = [{ symbol: "AAPL", weight: 90 }, { symbol: CASH, weight: 10 }];
    expect(removeHolding(only, "AAPL")).toEqual(only);
  });

  it("computes a shared path whose modules agree", () => {
    const snap = buildSnapshot(DEFAULT_HOLDINGS, "5Y");
    expect(snap.window.days).toBeGreaterThan(1000);
    expect(snap.kpis.value).toBeGreaterThan(10_000);
    expect(snap.kpis.vol).toBeGreaterThan(0.05);
    expect(snap.kpis.vol).toBeLessThan(0.6);
    expect(snap.growth[snap.growth.length - 1].book).toBeCloseTo(snap.kpis.value, 4);
    expect(snap.kpis.beta).toBeGreaterThan(0.4);
    expect(snap.kpis.beta).toBeLessThan(1.8);
    const risk = snap.contribution.reduce((s, c) => s + c.riskShare, 0);
    expect(risk).toBeCloseTo(1, 2);
    const ret = snap.contribution.reduce((s, c) => s + c.retShare, 0);
    expect(ret).toBeCloseTo(1, 2);
    expect(snap.corr.matrix[0][0]).toBe(1);
    expect(snap.corr.matrix[0][1]).toBeGreaterThan(0.2);
    expect(snap.corr.matrix[0][1]).toBeLessThan(0.99);
    expect(snap.factors.find((f) => f.id === "MKT")!.beta).toBeGreaterThan(0.4);
    expect(snap.distribution.var95).toBeLessThan(0);
    expect(snap.distribution.cvar).toBeLessThanOrEqual(snap.distribution.var95 + 1e-9);
    const covid = snap.scenarios.find((s) => s.id === "covid")!;
    const rates = snap.scenarios.find((s) => s.id === "rates")!;
    expect(covid.total).toBeLessThan(-0.15);
    expect(rates.total).toBeLessThan(0);
    expect(snap.kpis.maxDd).toBeLessThan(-0.08);
    expect(snap.sectors.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(100, 0);
  });

  it("arms systematic sleeves that sum to the same book", () => {
    const mom = sleeveHoldings(DEFAULT_HOLDINGS, "momentum");
    expect(mom.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(100, 5);
    const tape = diagnose(DEFAULT_HOLDINGS, "momentum").filter((s) => s.symbol !== CASH);
    const top = [...tape].sort((a, b) => b.momentum - a.momentum)[0];
    const bottom = [...tape].sort((a, b) => a.momentum - b.momentum)[0];
    expect(top.weight).toBeGreaterThan(bottom.weight);
    const inv = diagnose(DEFAULT_HOLDINGS, "invvol").filter((s) => s.symbol !== CASH && s.weight > 0);
    const quiet = [...inv].sort((a, b) => a.vol - b.vol)[0];
    const wild = [...inv].sort((a, b) => b.vol - a.vol)[0];
    expect(quiet.weight).toBeGreaterThan(wild.weight);
    const stats = compareSleeves(DEFAULT_HOLDINGS, "3Y");
    expect(stats).toHaveLength(7);
    for (const row of stats) {
      expect(Number.isFinite(row.total)).toBe(true);
      expect(row.spark.length).toBeGreaterThan(5);
    }
    expect(cagr([0.01, -0.01])).toBeCloseTo((1.01 * 0.99) ** (252 / 2) - 1, 6);
  });

  it("samples a frontier and a bootstrap fan", () => {
    const snap = buildSnapshot(DEFAULT_HOLDINGS, "1Y");
    const cloud = sampleFrontier(DEFAULT_HOLDINGS, "1Y", 7, 80);
    expect(cloud.length).toBe(80);
    const best = cloud.reduce((a, b) => (a.sharpe > b.sharpe ? a : b));
    expect(best.sharpe).toBeGreaterThan(0);
    const picked = frontierAtVol(cloud, snap.you.vol);
    expect(picked).not.toBeNull();
    const applied = applyFrontier(DEFAULT_HOLDINGS, picked!.weights);
    expect(applied.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(100, 5);
    const mc = projectMonteCarlo(snap.daily, 10, 3, 40);
    expect(mc.p5).toBeLessThan(mc.median);
    expect(mc.median).toBeLessThan(mc.p95);
    expect(mc.bands.length).toBeGreaterThan(10);
    const rects = layoutTreemap(
      snap.sectors.map((s) => ({ key: s.label, value: s.weight })),
      0,
      0,
      200,
      100,
    );
    const area = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(area).toBeCloseTo(20_000, 0);
  });
});
