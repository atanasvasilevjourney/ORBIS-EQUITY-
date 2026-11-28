/** Composite posture — weights from `shared/posture_composite.json` (mirrors pipeline). */
import config from "../../shared/posture_composite.json";

export type CompositeWeights = typeof config.weights;

export type CompositePillars = {
  breadth: number;
  trend: number;
  index_trend: number;
  highs_lows: number;
  risk: number;
  leadership?: number;
  participation?: number;
  vol?: number;
  heat_cap_pct?: number;
  guidance?: string;
};

function clip(x: number): number {
  if (!Number.isFinite(x)) return 50;
  return Math.min(100, Math.max(0, Math.round(x)));
}

export function compositeLabel(score: number, riskOff = false): string {
  let s = score;
  if (riskOff) s = Math.min(s, config.risk_off_cap_score);
  for (const band of config.labels) {
    if (s >= band.min) return band.name;
  }
  return "Bearish";
}

export function compositeScoreFromPillars(pillars: Record<string, number>): number {
  let total = 0;
  const w = config.weights as Record<string, number>;
  for (const [key, wt] of Object.entries(w)) {
    total += (pillars[key] ?? 50) * wt;
  }
  return clip(total);
}

export function resolveStoredPosture(inputs: Record<string, unknown> | undefined): {
  score: number | null;
  label: string | null;
  pillars: CompositePillars | null;
  riskOff: boolean;
} {
  if (!inputs) {
    return { score: null, label: null, pillars: null, riskOff: false };
  }
  const score = typeof inputs.posture_score === "number" ? inputs.posture_score : null;
  const label = typeof inputs.posture_label === "string" ? inputs.posture_label : null;
  const pillars = (inputs.posture_pillars as CompositePillars | undefined) ?? null;
  const composite = inputs.posture_composite as { risk_off?: boolean } | undefined;
  return {
    score,
    label,
    pillars,
    riskOff: !!composite?.risk_off,
  };
}