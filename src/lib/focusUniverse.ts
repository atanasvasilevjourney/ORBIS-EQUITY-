/** Client-side "my desk" symbol list — browse Nasdaq, then drive module APIs via `symbols=` query. */

import {
  getUniverseDesk,
  indexDeskQueryParam,
  isWatchlistDesk,
  setUniverseDesk,
  type UniverseDeskId,
} from "@/lib/universeDesk";

export type UniverseMode = "index" | "focus";

const FOCUS_KEY = "orbis-focus-universe";
const MODE_KEY = "orbis-universe-mode";
const NUDGE_DISMISSED_KEY = "orbis-focus-first-add-nudge-dismissed";
const MAX_FOCUS_SYMBOLS = 50;

/** Shared copy for desk vs index universe (EMA200 disclaimer, slide-over help). */
export const NASDAQ_VENUE_DISCLAIMER =
  "NASDAQ venue ≠ index universe: thousands of tickers trade on NASDAQ; the index desk covers ~600 large-cap names (S&P 500 + NDX-100) plus configured supplements.";

export const FOCUS_UNIVERSE_CHANGED = "orbis:focus-universe-changed";

function dispatchChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(FOCUS_UNIVERSE_CHANGED));
  }
}

function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase().replace(/^\$/, "");
}

export function getFocusSymbols(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FOCUS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => normalizeSymbol(String(x)))
      .filter((x) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x))
      .slice(0, MAX_FOCUS_SYMBOLS);
  } catch {
    return [];
  }
}

export function setFocusSymbols(symbols: string[]): void {
  if (typeof window === "undefined") return;
  const uniq: string[] = [];
  for (const s of symbols) {
    const t = normalizeSymbol(s);
    if (!t || uniq.includes(t)) continue;
    uniq.push(t);
    if (uniq.length >= MAX_FOCUS_SYMBOLS) break;
  }
  localStorage.setItem(FOCUS_KEY, JSON.stringify(uniq));
  dispatchChange();
}

export function addFocusSymbol(symbol: string): string[] {
  const t = normalizeSymbol(symbol);
  if (!t) return getFocusSymbols();
  const next = [t, ...getFocusSymbols().filter((x) => x !== t)].slice(0, MAX_FOCUS_SYMBOLS);
  setFocusSymbols(next);
  return next;
}

export function removeFocusSymbol(symbol: string): string[] {
  const t = normalizeSymbol(symbol);
  const next = getFocusSymbols().filter((x) => x !== t);
  setFocusSymbols(next);
  return next;
}

export function getUniverseDeskId(): UniverseDeskId {
  return getUniverseDesk();
}

export function setUniverseDeskId(desk: UniverseDeskId): void {
  setUniverseDesk(desk);
  dispatchChange();
}

export { type UniverseDeskId, DESK_LABELS, INDEX_DESKS } from "@/lib/universeDesk";

export function getUniverseMode(): UniverseMode {
  return isWatchlistDesk(getUniverseDesk()) ? "focus" : "index";
}

export function setUniverseMode(mode: UniverseMode): void {
  if (mode === "focus") setUniverseDesk("watchlist");
  else setUniverseDesk("sp500_ndx100");
  dispatchChange();
}

/** API query: `universe` for index desks, empty when on watchlist. */
export function universeDeskApiParam(): string {
  if (isWatchlistDesk(getUniverseDesk())) return "";
  return indexDeskQueryParam();
}

/** Comma-separated list for API query strings (empty when index mode or no symbols). */
export function focusSymbolsQueryParam(): string {
  if (!isWatchlistDesk(getUniverseDesk())) return "";
  const syms = getFocusSymbols();
  if (!syms.length) return "";
  return syms.join(",");
}

export function appendFocusQuery(url: string): string {
  const syms = focusSymbolsQueryParam();
  if (!syms) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}symbols=${encodeURIComponent(syms)}`;
}

export const FOCUS_SYMBOL_LIMIT = MAX_FOCUS_SYMBOLS;

export function isFirstAddNudgeDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(NUDGE_DISMISSED_KEY) === "1";
  } catch {
    return true;
  }
}

export function dismissFirstAddNudge(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(NUDGE_DISMISSED_KEY, "1");
}

/** First ~5 symbols for the global strip; remainder count for “+N more”. */
export function splitDeskChipPreview(symbols: string[], maxVisible = 5): {
  visible: string[];
  hiddenCount: number;
} {
  const visible = symbols.slice(0, maxVisible);
  return { visible, hiddenCount: Math.max(0, symbols.length - visible.length) };
}

export function deskEma200Href(symbols: string[]): string {
  if (!symbols.length) return "/ema200";
  const qs = new URLSearchParams({
    symbols: symbols.join(","),
    desk: "1",
  });
  return `/ema200?${qs.toString()}`;
}
