import { describe, expect, it } from "vitest";
import { corrMatrix, dailyReturns, parseCorr, pearson } from "@/lib/corr";
import { buildCanaries, equityFromCloses, voteFromSmooth } from "@/lib/canary";
import { alignCloses, liteQuantFromPrices, liteRotateFromPrices } from "@/lib/liteDesks";

describe("correlation", () => {
  it("identical series correlate at 1", () => {
    const a = [0.01, -0.02, 0.03, 0.00, 0.01, -0.01, 0.02, 0.01, -0.005, 0.004, 0.01, 0.02];
    expect(pearson(a, a)).toBeCloseTo(1, 8);
  });

  it("builds a symmetric matrix", () => {
    const { matrix, labels } = corrMatrix(
      ["A", "B"],
      [
        [0.01, 0.02, -0.01, 0.00, 0.01, 0.02, -0.01, 0.00, 0.01, 0.02],
        [0.02, 0.01, -0.02, 0.01, 0.00, 0.03, -0.01, 0.01, 0.00, 0.02],
      ]
    );
    expect(labels).toEqual(["A", "B"]);
    expect(matrix[0][0]).toBe(1);
    expect(matrix[0][1]).toBe(matrix[1][0]);
  });

  it("does not treat a missing close as a zero return", () => {
    const rets = dailyReturns([10, 11, Number.NaN, 12]);
    expect(rets[0]).toBeCloseTo(0.1, 8);
    expect(Number.isNaN(rets[1])).toBe(true);
    expect(Number.isNaN(rets[2])).toBe(true);
  });

  it("parseCorr reads a JSON matrix", () => {
    const c = parseCorr({ labels: ["A", "B"], matrix: [[1, 0.2], [0.2, 1]] });
    expect(c?.labels).toEqual(["A", "B"]);
    expect(c?.matrix[0][1]).toBe(0.2);
  });
});

describe("canaries", () => {
  it("votes the 0.25 band", () => {
    expect(voteFromSmooth(0.4)).toBe(1);
    expect(voteFromSmooth(-0.4)).toBe(-1);
    expect(voteFromSmooth(0.1)).toBe(0);
    expect(voteFromSmooth(0.4, true)).toBe(-1);
  });

  it("tech lead is risk-on", () => {
    const n = 260;
    const univ = Array.from({ length: n }, (_, i) => 100 * 1.001 ** i);
    const tech = Array.from({ length: n }, (_, i) => 100 * 1.004 ** i);
    const staples = Array.from({ length: n }, (_, i) => 100 * 1.0005 ** i);
    const disc = Array.from({ length: n }, (_, i) => 100 * 1.003 ** i);
    const energy = Array.from({ length: n }, (_, i) => 100 * 1.002 ** i);
    const financials = Array.from({ length: n }, (_, i) => 100 * 1.002 ** i);
    const reg = buildCanaries({ univ, tech, disc, staples, energy, defensive: staples, financials });
    expect(["RISK-ON", "STRONG RISK-ON"]).toContain(reg.regime);
    const qqq = reg.votes.find((v) => v.name === "QQQ/SPY");
    expect(qqq?.vote).toBe(1);
    expect((qqq?.tape.length ?? 0) > 10).toBe(true);
  });

  it("equity compounds equal weight", () => {
    const eq = equityFromCloses([[100, 110, 121]]);
    expect(eq.at(-1)).toBeCloseTo(1.21, 6);
  });
});

describe("lite desks", () => {
  it("quant lite emits a corr book", () => {
    const rows = [];
    for (const sym of ["AAA", "BBB"]) {
      for (let i = 0; i < 80; i++) {
        rows.push({ symbol: sym, date: `2024-03-${String((i % 28) + 1).padStart(2, "0")}`, close: 10 + i + (sym === "BBB" ? 1 : 0) });
      }
    }
    // unique dates
    const dated = [];
    for (const sym of ["AAA", "BBB"]) {
      for (let i = 0; i < 80; i++) {
        const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
        dated.push({ symbol: sym, date: d, close: 10 + i * (sym === "AAA" ? 0.1 : 0.08) });
      }
    }
    const lite = liteQuantFromPrices(dated);
    expect(lite.names.length).toBe(2);
    expect(lite.corr.labels).toEqual(["AAA", "BBB"]);
    expect(lite.lite).toBe(true);
  });

  it("aligns lite corr on a shared calendar instead of compressing gaps", () => {
    const book = new Map<string, { dates: string[]; close: number[] }>();
    const mk = (skip: Set<number>) => {
      const dates: string[] = [];
      const close: number[] = [];
      for (let i = 0; i < 80; i++) {
        if (skip.has(i)) continue;
        dates.push(new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
        close.push(10 + i);
      }
      return { dates, close };
    };
    book.set("AAA", mk(new Set()));
    book.set("BBB", mk(new Set([20, 21, 22, 23, 24, 25, 26, 27, 28, 29])));
    book.set("CCC", mk(new Set()));
    const { labels, closes } = alignCloses(book, ["AAA", "BBB", "CCC"]);
    expect(labels).toEqual(["AAA", "BBB", "CCC"]);
    expect(closes[0]).toHaveLength(closes[1].length);
    expect(closes[1].some((v) => Number.isNaN(v))).toBe(true);
    expect(closes[0].every((v) => Number.isFinite(v))).toBe(true);
  });

  it("rotate lite votes canaries from sector baskets", () => {
    const sectors = [
      ["AAPL", "Technology"],
      ["MSFT", "Technology"],
      ["XOM", "Energy"],
      ["JNJ", "Health Care"],
      ["PG", "Consumer Staples"],
      ["JPM", "Financials"],
      ["AMZN", "Consumer Discretionary"],
    ] as const;
    const rows = [];
    const meta = sectors.map(([symbol, sector]) => ({ symbol, sector }));
    for (const [symbol, sector] of sectors) {
      const g = sector === "Technology" ? 1.004 : sector === "Health Care" ? 1.0004 : 1.001;
      for (let i = 0; i < 260; i++) {
        const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
        rows.push({ symbol, date: d, close: 50 * g ** i, sector });
      }
    }
    const lite = liteRotateFromPrices(rows, meta);
    expect(lite.canaries.length).toBeGreaterThan(0);
    expect(lite.corr.labels.length).toBeGreaterThan(1);
    expect(lite.headline).toMatch(/lite canaries/);
  });
});
