import { describe, expect, it } from "vitest";
import {
  BREAKOUT_LOOKBACK,
  closeBreakout,
  dailyCloseBreakouts,
  highestPriorClose,
  rankBreakouts,
  rsiWilder,
  sparkCloseBreakouts,
  candleCloseBreakouts,
} from "@/lib/breakoutScan";

function day(i: number) {
  return new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
}

function ramp(n: number, start = 10, step = 0.1): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

describe("highestPriorClose", () => {
  it("matches Highest(close, 100)[1] — current bar excluded", () => {
    const closes = ramp(101, 1, 1); // 1..101
    expect(closes).toHaveLength(101);
    expect(highestPriorClose(closes, 100)).toBe(100);
    expect(closeBreakout(closes, 100)?.last).toBe(101);
    expect(closeBreakout(closes, 100)?.priorHigh).toBe(100);
  });

  it("does not fire when the last close is not a new high", () => {
    const closes = [...ramp(100, 1, 1), 50];
    expect(closeBreakout(closes, 100)).toBeNull();
  });

  it("needs lookback + 1 bars", () => {
    expect(highestPriorClose(ramp(100), 100)).toBeNull();
  });
});

describe("rsiWilder", () => {
  it("is high on a monotone ramp", () => {
    const rsi = rsiWilder(ramp(30, 10, 1));
    expect(rsi).not.toBeNull();
    expect(rsi as number).toBeGreaterThan(70);
  });
});

describe("dailyCloseBreakouts", () => {
  it("keeps a $1+ name with 1M volume breaking the 100-bar high", () => {
    const bars = Array.from({ length: 101 }, (_, i) => ({
      symbol: "AAA",
      date: day(i),
      open: 10 + i,
      high: 10 + i,
      low: 10 + i,
      close: 10 + i,
      volume: 2_000_000,
    }));
    const hits = dailyCloseBreakouts(bars, { AAA: "Test" });
    expect(hits).toHaveLength(1);
    expect(hits[0].ticker).toBe("AAA");
    expect(hits[0].lookback).toBe(BREAKOUT_LOOKBACK);
    expect(hits[0].priorHigh).toBe(10 + 99);
    expect(hits[0].last).toBe(10 + 100);
  });

  it("drops sub-$1 names like TRUG", () => {
    const bars = Array.from({ length: 101 }, (_, i) => ({
      symbol: "TRUG",
      date: day(i),
      open: 0.5 + i * 0.001,
      high: 0.5 + i * 0.001,
      low: 0.5 + i * 0.001,
      close: 0.5 + i * 0.001,
      volume: 25_000_000,
    }));
    expect(dailyCloseBreakouts(bars)).toEqual([]);
  });

  it("sorts by RSI when asked", () => {
    const mk = (symbol: string, closes: number[], vol: number) =>
      closes.map((close, i) => ({
        symbol,
        date: day(i),
        open: close,
        high: close,
        low: close,
        close,
        volume: vol,
      }));
    const volCloses = [...Array(90).fill(20), ...Array(10).fill(10), 21];
    const rsiCloses = ramp(101, 10, 0.5);
    const rows = dailyCloseBreakouts([...mk("VOL", volCloses, 9_000_000), ...mk("RSI", rsiCloses, 1_000_000)]);
    expect(rows).toHaveLength(2);
    expect(rankBreakouts(rows, "volume")[0].ticker).toBe("VOL");
    expect(rankBreakouts(rows, "rsi")[0].ticker).toBe("RSI");
  });
});

describe("sparkCloseBreakouts", () => {
  it("uses 5m closes and the daily volume filter", () => {
    const close = ramp(101, 10, 1);
    const hits = sparkCloseBreakouts(
      [
        {
          symbol: "AAA",
          response: [
            {
              meta: { symbol: "AAA" },
              indicators: { quote: [{ open: close, high: close, low: close, close, volume: close.map(() => 1) }] },
            },
          ],
        },
      ],
      { AAA: "Test" },
      { AAA: 2_000_000 }
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].tf).toBe("5m");
    expect(hits[0].priorHigh).toBe(109);
    expect(sparkCloseBreakouts(
      [
        {
          symbol: "THIN",
          response: [
            {
              meta: { symbol: "THIN" },
              indicators: { quote: [{ close: ramp(101, 10, 1) }] },
            },
          ],
        },
      ],
      {},
      { THIN: 100 }
    )).toEqual([]);
  });
});

describe("candleCloseBreakouts", () => {
  it("uses vault 5m closes and the daily volume filter", () => {
    const candles = ramp(101, 10, 1).map((close) => ({
      open: close,
      high: close,
      low: close,
      close,
    }));
    const hits = candleCloseBreakouts([{ ticker: "AAA", candles }], { AAA: "Test" }, { AAA: 2_000_000 });
    expect(hits).toHaveLength(1);
    expect(hits[0].tf).toBe("5m");
    expect(hits[0].priorHigh).toBe(109);
    expect(
      candleCloseBreakouts([{ ticker: "THIN", candles }], {}, { THIN: 100 })
    ).toEqual([]);
  });
});
