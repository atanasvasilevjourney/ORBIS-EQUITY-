/** Scale a raw bar onto its adjusted close so high/low/close share one price. */

export function adjustmentFactor(close: number, adjClose: number | null | undefined): number {
  if (adjClose == null || !Number.isFinite(adjClose) || !Number.isFinite(close) || close === 0) return 1;
  const factor = adjClose / close;
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function scaleOhlc(
  bar: { open: number; high: number; low: number; close: number },
  adjClose: number | null | undefined
): { open: number; high: number; low: number; close: number } {
  const factor = adjustmentFactor(bar.close, adjClose);
  const close =
    adjClose != null && Number.isFinite(adjClose) ? adjClose : bar.close * factor;
  return {
    open: bar.open * factor,
    high: bar.high * factor,
    low: bar.low * factor,
    close,
  };
}

/** Parse Postgres numeric (often a string) into a finite number. */
export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
