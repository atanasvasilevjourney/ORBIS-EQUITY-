/** Rule-based market brief. Numbers come only from the tape and the desk brief. */

import { indexSpread, signedPct, spreadCall } from "@/lib/rotationDesk";

export type BriefQuote = { symbol: string; dayPct: number | null };

export type MarketBriefInput = {
  pipelineBrief: string | null;
  postureLabel: string | null;
  advancersPct: number | null;
  bestSector: string | null;
  worstSector: string | null;
  regime: string | null;
  quotes: BriefQuote[];
};

export type MarketBrief = {
  text: string;
  source: "pipeline" | "tape" | "mixed";
};

function tapeLine(quotes: BriefQuote[]): string | null {
  const parts = ["SPY", "QQQ", "IWM"]
    .map((symbol) => {
      const row = quotes.find((quote) => quote.symbol === symbol);
      if (row?.dayPct == null || !Number.isFinite(row.dayPct)) return null;
      return `${symbol} ${signedPct(row.dayPct)}`;
    })
    .filter((part): part is string => part != null);
  if (!parts.length) return null;

  const iwm = quotes.find((quote) => quote.symbol === "IWM")?.dayPct ?? null;
  const qqq = quotes.find((quote) => quote.symbol === "QQQ")?.dayPct ?? null;
  const call = spreadCall(indexSpread(iwm, qqq));
  const lead = call ? ` — ${call.charAt(0).toLowerCase()}${call.slice(1)}` : "";
  return `Session tape: ${parts.join(", ")}${lead}.`;
}

function postureLine(input: MarketBriefInput): string | null {
  const bits: string[] = [];
  if (input.postureLabel) bits.push(input.postureLabel);
  if (input.advancersPct != null && Number.isFinite(input.advancersPct)) {
    bits.push(`${input.advancersPct}% of names advancing`);
  }
  if (input.bestSector) bits.push(`led by ${input.bestSector}`);
  if (input.worstSector) bits.push(`lagging ${input.worstSector}`);
  if (!bits.length) return null;
  return `${bits.join(", ")}.`;
}

function reconcilePostureWithTape(
  label: string | null,
  advancersPct: number | null,
  quotes: BriefQuote[]
): string | null {
  if (!label) return label;
  const spy = quotes.find((q) => q.symbol === "SPY")?.dayPct;
  const qqq = quotes.find((q) => q.symbol === "QQQ")?.dayPct;
  const iwm = quotes.find((q) => q.symbol === "IWM")?.dayPct;
  const idx = [spy, qqq, iwm].filter((v): v is number => v != null && Number.isFinite(v));
  if (!idx.length) return label;
  const avg = idx.reduce((s, v) => s + v, 0) / idx.length;
  const bulls = /bullish/i.test(label);
  const bears = /bearish/i.test(label);
  if (avg <= -0.75 && bulls) return label.replace(/bullish/i, "bearish");
  if (avg >= 0.75 && bears) return label.replace(/bearish/i, "bullish");
  if (avg <= -0.75 && advancersPct != null && advancersPct >= 55) {
    return label.replace(/slight bullish|bullish/i, "mixed");
  }
  return label;
}

export function composeMarketBrief(input: MarketBriefInput): MarketBrief {
  const pipeline = input.pipelineBrief?.trim() || null;
  const tape = tapeLine(input.quotes);
  const postureLabel = reconcilePostureWithTape(
    input.postureLabel,
    input.advancersPct,
    input.quotes
  );
  const posture = postureLine({ ...input, postureLabel });
  const regime =
    input.regime && input.regime.trim() ? `Rotation regime ${input.regime.trim()}.` : null;

  if (pipeline && tape) {
    const end = pipeline.slice(-1);
    const glue = end === "." || end === "!" || end === "?" ? " " : ". ";
    return { text: `${pipeline}${glue}${tape}`, source: "mixed" };
  }
  if (pipeline) return { text: pipeline, source: "pipeline" };

  const lines = [posture, tape, regime].filter((line): line is string => !!line);
  return { text: lines.join(" "), source: "tape" };
}
