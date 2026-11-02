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

export function composeMarketBrief(input: MarketBriefInput): MarketBrief {
  const pipeline = input.pipelineBrief?.trim() || null;
  const tape = tapeLine(input.quotes);
  const posture = postureLine(input);
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
