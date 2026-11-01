/** Factor investing desk — style definitions aligned with pipeline/compute/factor_scores.py */

export type FactorStyleId =
  | "value"
  | "quality"
  | "growth"
  | "earnings_quality"
  | "leverage";

export type FactorStyleDef = {
  id: FactorStyleId;
  label: string;
  weight: number;
  scoreField: string;
  inputs: string[];
  screenerMinField: string;
};

export const FACTOR_STYLES: FactorStyleDef[] = [
  {
    id: "value",
    label: "VALUE",
    weight: 0.25,
    scoreField: "value_score",
    screenerMinField: "min_value_score",
    inputs: ["P/E", "P/B", "EV/EBITDA", "Earnings yield", "FCF yield"],
  },
  {
    id: "quality",
    label: "QUALITY",
    weight: 0.25,
    scoreField: "quality_score",
    screenerMinField: "min_quality_score",
    inputs: ["ROE", "ROIC", "Margins", "Piotroski F-Score"],
  },
  {
    id: "growth",
    label: "GROWTH",
    weight: 0.2,
    scoreField: "growth_score",
    screenerMinField: "min_growth_score",
    inputs: ["Revenue growth 1y/3y", "EPS growth"],
  },
  {
    id: "earnings_quality",
    label: "EARNINGS Q",
    weight: 0.15,
    scoreField: "earnings_quality_score",
    screenerMinField: "min_earnings_quality_score",
    inputs: ["Accruals (CFO − NI) / assets"],
  },
  {
    id: "leverage",
    label: "LEVERAGE",
    weight: 0.15,
    scoreField: "leverage_score",
    screenerMinField: "min_leverage_score",
    inputs: ["Current ratio", "D/E", "Interest coverage"],
  },
];

export type FactorRowScores = {
  symbol: string;
  valueScore: number | null;
  qualityScore: number | null;
  growthScore: number | null;
  earningsQualityScore: number | null;
  leverageScore: number | null;
  compositeScore: number | null;
};

export type StyleLeader = {
  symbol: string;
  companyName: string;
  sector: string;
  score: number;
  compositeScore: number | null;
};

export type StyleSummary = {
  id: FactorStyleId;
  label: string;
  weight: number;
  inputs: string[];
  avgScore: number | null;
  namesScored: number;
  topQuartile: number;
  leaders: StyleLeader[];
  screenerHref: string;
};

export type SectorFactorRow = {
  sector: string;
  nNames: number;
  avgComposite: number | null;
  valueBreadth: number | null;
  qualityBreadth: number | null;
  growthBreadth: number | null;
};

export function avgFinite(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

export function breadthAtLeast(
  values: (number | null | undefined)[],
  floor: number
): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  const hit = nums.filter((v) => v >= floor).length;
  return hit / nums.length;
}

function scoreForStyle(row: FactorRowScores, id: FactorStyleId): number | null {
  switch (id) {
    case "value":
      return row.valueScore;
    case "quality":
      return row.qualityScore;
    case "growth":
      return row.growthScore;
    case "earnings_quality":
      return row.earningsQualityScore;
    case "leverage":
      return row.leverageScore;
    default:
      return null;
  }
}

export function styleScreenerHref(style: FactorStyleDef, minScore = 70): string {
  const params = new URLSearchParams({
    sort: style.scoreField,
    dir: "desc",
    [style.screenerMinField]: String(minScore),
  });
  return `/fundamentals/screener?${params.toString()}`;
}

export function buildStyleSummaries(
  rows: (FactorRowScores & { companyName: string; sector: string })[],
  leaderLimit = 8
): StyleSummary[] {
  return FACTOR_STYLES.map((style) => {
    const scores = rows.map((r) => scoreForStyle(r, style.id));
    const leaders = rows
      .map((r) => ({
        symbol: r.symbol,
        companyName: r.companyName,
        sector: r.sector,
        score: scoreForStyle(r, style.id),
        compositeScore: r.compositeScore,
      }))
      .filter((r): r is StyleLeader & { score: number } => r.score != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, leaderLimit)
      .map(({ score, ...rest }) => ({ ...rest, score }));

    return {
      id: style.id,
      label: style.label,
      weight: style.weight,
      inputs: style.inputs,
      avgScore: avgFinite(scores),
      namesScored: scores.filter((s) => s != null).length,
      topQuartile: scores.filter((s) => s != null && s >= 75).length,
      leaders,
      screenerHref: styleScreenerHref(style),
    };
  });
}

export function buildSectorFactorRows(
  rows: (FactorRowScores & { sector: string })[]
): SectorFactorRow[] {
  const bySector = new Map<string, (FactorRowScores & { sector: string })[]>();
  for (const row of rows) {
    const sector = row.sector || "Unknown";
    const list = bySector.get(sector) ?? [];
    list.push(row);
    bySector.set(sector, list);
  }

  return Array.from(bySector.entries()).map(([sector, group]) => ({
      sector,
      nNames: group.length,
      avgComposite: avgFinite(group.map((r) => r.compositeScore)),
      valueBreadth: breadthAtLeast(
        group.map((r) => r.valueScore),
        50
      ),
      qualityBreadth: breadthAtLeast(
        group.map((r) => r.qualityScore),
        50
      ),
      growthBreadth: breadthAtLeast(
        group.map((r) => r.growthScore),
        50
      ),
    }))
    .filter((s) => s.nNames >= 3)
    .sort((a, b) => (b.avgComposite ?? -1) - (a.avgComposite ?? -1));
}
