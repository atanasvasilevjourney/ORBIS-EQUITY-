/** Index desk presets + user watchlist (client persistence & labels). */

export type IndexDeskId = "sp500_ndx100" | "sp500" | "ndx100" | "sp500_top100" | "nasdaq_all";
export type UniverseDeskId = IndexDeskId | "watchlist";

const DESK_KEY = "orbis-universe-desk";
const LEGACY_MODE_KEY = "orbis-universe-mode";

export const INDEX_DESKS: IndexDeskId[] = [
  "nasdaq_all",
  "ndx100",
  "sp500",
  "sp500_top100",
  "sp500_ndx100",
];

export const DESK_LABELS: Record<UniverseDeskId, string> = {
  nasdaq_all: "Full Nasdaq",
  ndx100: "Nasdaq-100",
  sp500: "S&P 500",
  sp500_top100: "S&P top 100",
  sp500_ndx100: "S&P + NDX",
  watchlist: "My watchlist",
};

export const DESK_SHORT: Record<UniverseDeskId, string> = {
  nasdaq_all: "NDAQ ALL",
  ndx100: "NDX-100",
  sp500: "S&P 500",
  sp500_top100: "S&P T100",
  sp500_ndx100: "S&P+NDX",
  watchlist: "MY LIST",
};

export function isWatchlistDesk(desk: UniverseDeskId): boolean {
  return desk === "watchlist";
}

export function parseUniverseDeskParam(raw: string | null): UniverseDeskId | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "watchlist" || v === "focus") return "watchlist";
  if (INDEX_DESKS.includes(v as IndexDeskId)) return v as IndexDeskId;
  return null;
}

function migrateLegacyMode(): UniverseDeskId {
  if (typeof window === "undefined") return "sp500_ndx100";
  try {
    const existing = localStorage.getItem(DESK_KEY);
    if (existing && parseUniverseDeskParam(existing)) {
      return parseUniverseDeskParam(existing)!;
    }
    const legacy = localStorage.getItem(LEGACY_MODE_KEY);
    if (legacy === "focus") return "watchlist";
  } catch {
    /* ignore */
  }
  return "sp500_ndx100";
}

export function getUniverseDesk(): UniverseDeskId {
  if (typeof window === "undefined") return "sp500_ndx100";
  try {
    const raw = localStorage.getItem(DESK_KEY);
    const parsed = parseUniverseDeskParam(raw);
    if (parsed) return parsed;
    const migrated = migrateLegacyMode();
    localStorage.setItem(DESK_KEY, migrated);
    return migrated;
  } catch {
    return "sp500_ndx100";
  }
}

export function setUniverseDesk(desk: UniverseDeskId): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DESK_KEY, desk);
  if (desk === "watchlist") {
    localStorage.setItem(LEGACY_MODE_KEY, "focus");
  } else {
    localStorage.setItem(LEGACY_MODE_KEY, "index");
  }
}

/** Query param for index desks (omit when watchlist — use symbols= instead). */
export function indexDeskQueryParam(): string {
  const desk = getUniverseDesk();
  if (desk === "watchlist") return "";
  return desk;
}

export type UniverseMemberRow = {
  symbol: string;
  tier: string | null;
  exchange: string | null;
  country: string | null;
  is_active?: boolean | null;
};

export type MarketCapRow = { symbol: string; market_cap: number | null };

export type Ema200UniverseRow = { symbol: string; index_tag: string | null };

/** Pure filter for tests — resolves symbol list for an index desk from member rows. */
export function filterSymbolsForIndexDesk(
  desk: IndexDeskId,
  members: UniverseMemberRow[],
  marketCaps: MarketCapRow[] = [],
  ema200Universe: Ema200UniverseRow[] = []
): string[] {
  const active = members.filter((m) => m.is_active !== false && m.symbol);
  const capMap = new Map(marketCaps.map((m) => [m.symbol, m.market_cap ?? 0]));
  const indexTag = new Map(ema200Universe.map((r) => [r.symbol, r.index_tag]));

  const isNasdaqExchange = (ex: string | null) =>
    (ex ?? "").toUpperCase().includes("NASDAQ");

  if (desk === "sp500_ndx100") {
    return active
      .filter((m) => m.tier === "us_large" || m.tier === "us_nasdaq100")
      .map((m) => m.symbol);
  }

  if (desk === "sp500") {
    return active.filter((m) => m.tier === "us_large").map((m) => m.symbol);
  }

  if (desk === "ndx100") {
    const ndxOnly = new Set(
      active.filter((m) => m.tier === "us_nasdaq100").map((m) => m.symbol)
    );
    for (const m of active) {
      if (m.tier === "us_large" && isNasdaqExchange(m.exchange)) ndxOnly.add(m.symbol);
      if (indexTag.get(m.symbol) === "ndx100") ndxOnly.add(m.symbol);
    }
    return Array.from(ndxOnly);
  }

  if (desk === "sp500_top100") {
    const sp = active.filter((m) => m.tier === "us_large");
    return sp
      .sort((a, b) => (capMap.get(b.symbol) ?? 0) - (capMap.get(a.symbol) ?? 0))
      .slice(0, 100)
      .map((m) => m.symbol);
  }

  if (desk === "nasdaq_all") {
    return active
      .filter(
        (m) =>
          (m.country ?? "US").toUpperCase() === "US" &&
          (isNasdaqExchange(m.exchange) ||
            m.tier === "us_nasdaq100" ||
            m.tier === "us_nasdaq_listed")
      )
      .map((m) => m.symbol);
  }

  return [];
}
