import { describe, expect, it } from "vitest";
import { screenClose, stickyLong } from "@/lib/temaScreen";

describe("stickyLong", () => {
  it("stays on through a vote dip and turns off when the regime breaks", () => {
    const regimeUp = [...Array(5).fill(false), ...Array(10).fill(true), ...Array(5).fill(false)];
    const votes = [...Array(5).fill(0), ...Array(3).fill(3), ...Array(7).fill(0), ...Array(5).fill(3)];
    const pos = stickyLong(regimeUp, votes, 5);
    expect(pos[5]).toBe(true);
    expect(pos[8]).toBe(true);
    expect(pos[14]).toBe(true);
    expect(pos[15]).toBe(false);
    expect(pos.slice(0, 5).some(Boolean)).toBe(false);
  });

  it("does not open a short below the regime line", () => {
    const pos = stickyLong(Array(12).fill(false), Array(12).fill(3), 2);
    expect(pos.some(Boolean)).toBe(false);
  });
});

describe("screenClose", () => {
  it("returns a vote count on a series long enough for TEMA-199", () => {
    const close = Array.from({ length: 260 }, (_, i) => 100 * Math.exp(0.001 * i));
    const row = screenClose(close);
    expect(row).not.toBeNull();
    expect(row!.votes).toBeGreaterThanOrEqual(0);
    expect(row!.votes).toBeLessThanOrEqual(3);
  });

  it("returns null before the regime can exist", () => {
    expect(screenClose(Array.from({ length: 80 }, (_, i) => 50 + i))).toBeNull();
  });
});
