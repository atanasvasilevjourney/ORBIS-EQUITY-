/** Fundamental screener query parsing and preset definitions (Norn-style ranges + ORBIS EQUITY presets). */

export type ScreenerPresetId =
  | "custom"
  | "quality_value"
  | "graham"
  | "lynch"
  | "growth"
  | "conviction";

export type RangeBounds = { min?: number; max?: number };

export type ScreenerQuery = {
  preset: ScreenerPresetId;
  sector?: string;
  industry?: string;
  country?: string;
  region?: "us" | "uk" | "eu" | "all";
  verdict?: string;
  watchlistOnly: boolean;
  minRank: number;
  ranges: Record<string, RangeBounds>;
  sort: string;
  sortAsc: boolean;
  limit: number;
};

/** DB column keys that accept min_<key> / max_<key> query params (snake_case). */
export const SCREENER_RANGE_FIELDS = [
  "market_cap",
  "pe_ratio",
  "pb_ratio",
  "ps_ratio",
  "ev_ebitda",
  "dividend_yield",
  "roe",
  "roa",
  "roic",
  "net_margin",
  "debt_to_equity",
  "current_ratio",
  "revenue_growth_1y",
  "eps_growth_1y",
  "f_score",
  "value_score",
  "quality_score",
  "growth_score",
  "earnings_quality_score",
  "leverage_score",
  "composite_factor_score",
] as const;

export type ScreenerRangeField = (typeof SCREENER_RANGE_FIELDS)[number];

export const REGION_COUNTRIES: Record<string, string[]> = {
  us: ["US"],
  uk: ["GB"],
  eu: ["DE", "FR", "NL", "ES", "IT", "CH", "IE"],
};

export const FUNDAMENTAL_PRESETS: Record<
  Exclude<ScreenerPresetId, "custom">,
  { label: string; description: string; patch: Partial<ScreenerQuery> & { ranges?: Record<string, RangeBounds> } }
> = {
  quality_value: {
    label: "Quality value",
    description: "High composite & F-Score, modest P/E, solid ROE",
    patch: {
      ranges: {
        composite_factor_score: { min: 65 },
        f_score: { min: 6 },
        pe_ratio: { min: 0.01, max: 22 },
        roe: { min: 0.1 },
      },
    },
  },
  graham: {
    label: "Graham",
    description: "Low P/E & P/B, adequate liquidity",
    patch: {
      ranges: {
        pe_ratio: { min: 0.01, max: 15 },
        pb_ratio: { min: 0, max: 1.5 },
        current_ratio: { min: 1.5 },
      },
    },
  },
  lynch: {
    label: "Lynch",
    description: "Growth at reasonable P/E",
    patch: {
      ranges: {
        pe_ratio: { min: 0.01, max: 25 },
        eps_growth_1y: { min: 0.12 },
        roe: { min: 0.1 },
      },
    },
  },
  growth: {
    label: "Growth",
    description: "Top growth factor & revenue momentum",
    patch: {
      ranges: {
        growth_score: { min: 70 },
        revenue_growth_1y: { min: 0.08 },
      },
    },
  },
  conviction: {
    label: "Conviction",
    description: "On watchlist with strong fundamentals",
    patch: {
      watchlistOnly: true,
      minRank: 50,
      ranges: {
        composite_factor_score: { min: 60 },
      },
    },
  },
};

const ALLOWED_SORTS = new Set<string>([
  ...SCREENER_RANGE_FIELDS,
  "price",
  "gross_margin",
  "operating_margin",
]);

function parseNum(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseScreenerQuery(sp: URLSearchParams): ScreenerQuery | { error: string } {
  const presetRaw = (sp.get("preset") ?? "custom") as ScreenerPresetId;
  const preset: ScreenerPresetId =
    presetRaw === "custom" || presetRaw in FUNDAMENTAL_PRESETS ? presetRaw : "custom";

  const ranges: Record<string, RangeBounds> = {};
  for (const field of SCREENER_RANGE_FIELDS) {
    const min = parseNum(sp.get(`min_${field}`));
    const max = parseNum(sp.get(`max_${field}`));
    if (min !== undefined || max !== undefined) {
      ranges[field] = { min, max };
    }
  }

  const minRank = parseInt(sp.get("min_rank") ?? "0", 10);
  const limit = Math.min(parseInt(sp.get("limit") ?? "300", 10), 1000);
  const rawSort = sp.get("sort") ?? "composite_factor_score";
  const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : "composite_factor_score";

  if (Number.isNaN(minRank) || Number.isNaN(limit)) {
    return { error: "Invalid min_rank or limit" };
  }

  let q: ScreenerQuery = {
    preset,
    sector: sp.get("sector") || undefined,
    industry: sp.get("industry") || undefined,
    country: sp.get("country") || undefined,
    region: (sp.get("region") as ScreenerQuery["region"]) || undefined,
    verdict: sp.get("verdict") || undefined,
    watchlistOnly: sp.get("watchlist_only") === "1" || sp.get("watchlist_only") === "true",
    minRank,
    ranges,
    sort,
    sortAsc: sp.get("dir") === "asc",
    limit,
  };

  if (preset !== "custom") {
    q = mergePreset(q, preset);
  }

  return q;
}

export function mergePreset(base: ScreenerQuery, presetId: Exclude<ScreenerPresetId, "custom">): ScreenerQuery {
  const def = FUNDAMENTAL_PRESETS[presetId];
  const mergedRanges = { ...base.ranges };
  if (def.patch.ranges) {
    for (const [k, v] of Object.entries(def.patch.ranges)) {
      mergedRanges[k] = { ...mergedRanges[k], ...v };
    }
  }
  return {
    ...base,
    preset: presetId,
    watchlistOnly: def.patch.watchlistOnly ?? base.watchlistOnly,
    minRank: def.patch.minRank ?? base.minRank,
    sector: def.patch.sector ?? base.sector,
    ranges: mergedRanges,
  };
}

export type FundRowForScreen = Record<string, number | string | null | undefined>;

export function inRange(
  value: number | null | undefined,
  bounds?: RangeBounds
): boolean {
  if (!bounds || (bounds.min === undefined && bounds.max === undefined)) return true;
  if (value == null || Number.isNaN(value)) return false;
  if (bounds.min !== undefined && value < bounds.min) return false;
  if (bounds.max !== undefined && value > bounds.max) return false;
  return true;
}

export function matchesScreener(
  row: FundRowForScreen,
  meta: { sector?: string | null; industry?: string | null; country?: string | null },
  radar: { state: number; quality_rank: number } | undefined,
  q: ScreenerQuery
): boolean {
  if (q.sector && meta.sector !== q.sector) return false;
  if (q.industry && meta.industry !== q.industry) return false;
  if (q.country && meta.country !== q.country) return false;
  if (q.region && q.region !== "all") {
    const countries = REGION_COUNTRIES[q.region];
    if (countries && !countries.includes(meta.country ?? "")) return false;
  }
  if (q.verdict && row.fundamental_verdict !== q.verdict) return false;
  if (q.watchlistOnly && (!radar || radar.state !== 1)) return false;
  if (q.minRank > 0 && (!radar || radar.quality_rank < q.minRank)) return false;

  for (const [field, bounds] of Object.entries(q.ranges)) {
    const v = row[field] as number | null | undefined;
    if (!inRange(v, bounds)) return false;
  }
  return true;
}

export function screenerQueryToSearchParams(q: ScreenerQuery): URLSearchParams {
  const sp = new URLSearchParams();
  if (q.preset !== "custom") sp.set("preset", q.preset);
  if (q.sector) sp.set("sector", q.sector);
  if (q.industry) sp.set("industry", q.industry);
  if (q.country) sp.set("country", q.country);
  if (q.region && q.region !== "all") sp.set("region", q.region);
  if (q.verdict) sp.set("verdict", q.verdict);
  if (q.watchlistOnly) sp.set("watchlist_only", "1");
  if (q.minRank > 0) sp.set("min_rank", String(q.minRank));
  sp.set("sort", q.sort);
  if (q.sortAsc) sp.set("dir", "asc");
  sp.set("limit", String(q.limit));
  for (const [field, bounds] of Object.entries(q.ranges)) {
    if (bounds.min !== undefined) sp.set(`min_${field}`, String(bounds.min));
    if (bounds.max !== undefined) sp.set(`max_${field}`, String(bounds.max));
  }
  return sp;
}

/** UI filter rows (subset for the screener form). */
export const SCREENER_UI_FILTERS: {
  field: ScreenerRangeField;
  label: string;
  hint?: string;
  step?: string;
}[] = [
  { field: "market_cap", label: "Market cap", hint: "USD" },
  { field: "pe_ratio", label: "P/E" },
  { field: "pb_ratio", label: "P/B" },
  { field: "roe", label: "ROE", hint: "decimal e.g. 0.15" },
  { field: "debt_to_equity", label: "Debt / equity" },
  { field: "dividend_yield", label: "Div yield", hint: "decimal" },
  { field: "revenue_growth_1y", label: "Rev growth 1Y", hint: "decimal" },
  { field: "composite_factor_score", label: "Composite", step: "1" },
  { field: "f_score", label: "F-Score", step: "1" },
  { field: "value_score", label: "Value score", step: "1" },
  { field: "growth_score", label: "Growth score", step: "1" },
];
