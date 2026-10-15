/** Client-side "my desk" symbol list — browse Nasdaq, then drive module APIs via `symbols=` query. */

export type UniverseMode = "index" | "focus";

const FOCUS_KEY = "orbis-focus-universe";
const MODE_KEY = "orbis-universe-mode";
const MAX_FOCUS_SYMBOLS = 50;

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

export function getUniverseMode(): UniverseMode {
  if (typeof window === "undefined") return "index";
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === "focus" ? "focus" : "index";
  } catch {
    return "index";
  }
}

export function setUniverseMode(mode: UniverseMode): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MODE_KEY, mode === "focus" ? "focus" : "index");
  dispatchChange();
}

/** Comma-separated list for API query strings (empty when index mode or no symbols). */
export function focusSymbolsQueryParam(): string {
  if (getUniverseMode() !== "focus") return "";
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
