/** Labels match pipeline.compute.aggregates.compute_posture_label. */

export function postureLabelFromScore(score: number): string {
  if (score >= 75) return "Bullish";
  if (score >= 60) return "Slight Bullish";
  if (score >= 40) return "Neutral";
  if (score >= 25) return "Slight Bearish";
  return "Bearish";
}
