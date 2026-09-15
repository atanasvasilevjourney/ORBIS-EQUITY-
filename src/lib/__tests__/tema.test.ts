import { describe, expect, it } from "vitest";
import { ema, macd, macdCloseAction, tema, temaTape, TEMA_MIN_BARS } from "@/lib/tema";

function ramp(n: number, start = 40, g = 1.006): { time: string; high: number; low: number; close: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const close = start * g ** i;
    return { time: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`, high: close * 1.004, low: close * 0.996, close };
  });
}

describe("tema math", () => {
  it("EMA is flat on a constant series", () => {
    const x = Array(20).fill(10);
    expect(ema(x, 8).every((v) => Math.abs(v - 10) < 1e-9)).toBe(true);
  });

  it("TEMA sits closer to the last print than EMA on a ramp", () => {
    const x = Array.from({ length: 80 }, (_, i) => 1 + i * 0.6);
    const e = ema(x, 21).at(-1)!;
    const t = tema(x, 21).at(-1)!;
    expect(Math.abs(t - x[x.length - 1])).toBeLessThan(Math.abs(e - x[x.length - 1]));
  });

  it("uptrend tape is BUY with MACD HOLD", () => {
    const { bars, readout } = temaTape(ramp(280));
    expect(bars.length).toBe(280);
    expect(readout?.side).toBe("BUY");
    expect(readout?.macdAction).toBe("HOLD");
    expect((readout?.score ?? 0) >= 65).toBe(true);
  });

  it("needs 220 bars", () => {
    expect(temaTape(ramp(100)).readout).toBeNull();
    expect(TEMA_MIN_BARS).toBe(220);
  });

  it("MACD close flips a long when the line crosses under signal", () => {
    expect(macdCloseAction("BUY", 1, 0)).toBe("HOLD");
    expect(macdCloseAction("BUY", -1, 0)).toBe("CLOSE");
    expect(macdCloseAction("SELL", -1, 0)).toBe("HOLD");
    expect(macdCloseAction("FLAT", 1, 0)).toBe("HOLD");
  });

  it("MACD hist is line minus signal", () => {
    const x = ramp(80).map((c) => c.close);
    const m = macd(x);
    expect(m.hist[m.hist.length - 1]).toBeCloseTo(m.line[m.line.length - 1] - m.signal[m.signal.length - 1], 10);
  });
});
