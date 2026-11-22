export type ResearchIdeaRow = {
  run_id: string;
  rank: number;
  symbol: string;
  company_name: string | null;
  source: string | null;
  theme: string | null;
  side: string | null;
  horizon: string | null;
  confidence: string | null;
  entry_px: number | null;
  stop_px: number | null;
  target_px: number | null;
  rr: number | null;
  last_px: number | null;
  quality_rank: number | null;
  factor_score: number | null;
  rationale: string | null;
  meta: Record<string, unknown> | null;
};

export function mapResearchIdea(s: ResearchIdeaRow) {
  const meta = (s.meta && typeof s.meta === "object" ? s.meta : {}) as Record<string, unknown>;
  const entryZone = Array.isArray(meta.entry_zone)
    ? (meta.entry_zone as number[])
  : s.entry_px != null
    ? [s.entry_px, s.entry_px]
    : null;
  const sources = Array.isArray(meta.sources)
    ? (meta.sources as string[])
    : s.source
      ? [s.source]
      : [];
  const wrongTest =
    typeof meta.wrong_test === "string"
      ? meta.wrong_test
      : typeof meta.wrongTest === "string"
        ? meta.wrongTest
        : null;
  const direction = (s.side || "LONG").toUpperCase();
  return {
    rank: s.rank,
    ticker: s.symbol,
    companyName: s.company_name ?? "",
    theme: s.theme,
    direction,
    horizon: s.horizon || "medium_term",
    confidence: s.confidence,
    source: s.source,
    sources,
    entry: s.entry_px,
    entryZone,
    stop: s.stop_px,
    stopInvalidation: s.stop_px,
    target: s.target_px,
    rr: s.rr,
    last: s.last_px,
    qualityRank: s.quality_rank,
    factorScore: s.factor_score,
    rationale: s.rationale,
    wrongTest,
    meta,
    side: direction,
  };
}

export function bucketByHorizon<T extends { horizon: string }>(ideas: T[]) {
  return {
    short_term: ideas.filter((i) => i.horizon === "short_term"),
    medium_term: ideas.filter((i) => i.horizon === "medium_term"),
    long_term: ideas.filter((i) => i.horizon === "long_term"),
  };
}