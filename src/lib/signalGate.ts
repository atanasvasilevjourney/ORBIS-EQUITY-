/** Mask actionable desk signals when tape is stale (Phase 1 freshness gate). */

const ACTIONABLE = new Set(["BUY", "SELL", "ENTER", "EXIT", "LONG", "SHORT"]);

export function isActionableSide(side: string | null | undefined): boolean {
  if (!side) return false;
  return ACTIONABLE.has(side.toUpperCase());
}

export function gateAction(action: string | null | undefined, suppressed: boolean): string {
  if (!suppressed || !action) return action ?? "—";
  return ACTIONABLE.has(action.toUpperCase()) ? "HOLD" : action;
}

export function gateSide(side: string | null | undefined, suppressed: boolean): string | null {
  if (!side || !suppressed) return side ?? null;
  return isActionableSide(side) ? "FLAT" : side;
}

export type DeskOrder = { action?: string | null; type?: string | null; reason?: string | null };

export function gateOrders<T extends DeskOrder>(orders: T[], suppressed: boolean): T[] {
  if (!suppressed) return orders;
  return orders.map((o) => ({
    ...o,
    action: gateAction(o.action ?? null, true),
    reason: o.reason ? `[STALE] ${o.reason}` : "[STALE] Signals suppressed — data older than 1 trading day",
  }));
}

export function staleHeadline(headline: string | null | undefined, suppressed: boolean): string | null {
  if (!headline) return suppressed ? "STALE — signals suppressed" : null;
  if (!suppressed) return headline;
  if (headline.startsWith("STALE")) return headline;
  return `STALE — ${headline}`;
}
