/** Unified 1–99 desk score: technical watchlist rank + fundamental composite. */
export function orbisScore(
  qualityRank: number | null | undefined,
  compositeScore: number | null | undefined
): number | null {
  if (qualityRank == null && compositeScore == null) return null;
  const q = qualityRank ?? 50;
  const c = compositeScore ?? 50;
  return Math.round(Math.min(99, Math.max(1, 0.6 * q + 0.4 * c)));
}

export function orbisScoreColor(score: number | null | undefined): string {
  if (score == null) return "";
  if (score >= 85) return "var(--accent-bull)";
  if (score >= 70) return "var(--accent-info)";
  if (score <= 35) return "var(--accent-bear)";
  return "";
}
