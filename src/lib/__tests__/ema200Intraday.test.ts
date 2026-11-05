import { describe, expect, it } from "vitest";
import { detectPhase3Triggers, type Merged5mRow } from "@/lib/ema200Intraday";

function row(partial: Partial<Merged5mRow> & Pick<Merged5mRow, "time">): Merged5mRow {
  return {
    close: 100,
    high: 101,
    low: 99,
    volume: 1000,
    ema200Daily: 99,
    ema200HighDaily: 100,
    ribbonDistAtrDaily: 0.4,
    rvol5m: 1.5,
    ...partial,
  };
}

describe("detectPhase3Triggers", () => {
  it("skips when daily setup missing and watchlist required", () => {
    const merged = [
      row({ time: "2026-09-30T13:35:00-04:00", ribbonDistAtrDaily: 0.3 }),
      row({ time: "2026-09-30T14:00:00-04:00", ribbonDistAtrDaily: 0.3 }),
    ];
    expect(detectPhase3Triggers("TEST", merged, null)).toEqual([]);
  });

  it("fires at-ribbon on last RTH bar", () => {
    const merged = [
      row({ time: "2026-09-30T13:35:00-04:00", ribbonDistAtrDaily: 0.8 }),
      row({ time: "2026-09-30T14:00:00-04:00", ribbonDistAtrDaily: 0.35, close: 100.2 }),
    ];
    const hits = detectPhase3Triggers("TEST", merged, "RETRACE_HELD");
    expect(hits).toHaveLength(1);
    expect(hits[0].triggerType).toBe("INTRADAY_AT_RIBBON");
  });

  it("reclaim requires RETRACE_HELD (at-ribbon may still fire)", () => {
    const merged = [
      row({ time: "2026-09-30T13:35:00-04:00", close: 98.5, ribbonDistAtrDaily: 2 }),
      row({ time: "2026-09-30T14:00:00-04:00", close: 100.2, ribbonDistAtrDaily: 0.35 }),
    ];
    const hits = detectPhase3Triggers("TEST", merged, "APPROACHING");
    expect(hits.some((t) => t.triggerType === "INTRADAY_RECLAIM")).toBe(false);
  });

  it("prefers reclaim over at-ribbon", () => {
    const merged = [
      row({ time: "2026-09-30T13:35:00-04:00", close: 98.5, ribbonDistAtrDaily: 2 }),
      row({ time: "2026-09-30T14:00:00-04:00", close: 100.2, ribbonDistAtrDaily: 0.35 }),
    ];
    const hits = detectPhase3Triggers("TEST", merged, "RETRACE_HELD");
    expect(hits).toHaveLength(1);
    expect(hits[0].triggerType).toBe("INTRADAY_RECLAIM");
  });
});
