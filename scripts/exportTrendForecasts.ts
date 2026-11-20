/**
 * Daily trend-diagnostics forecasts from the production module.
 *
 * Input JSON: { "SPY": { "crypto": false, "close": number[] }, ... }
 * Output JSON: combined, ewmac, agree, state aligned to those closes.
 * The research backtest shells out to this so it cannot drift from the desk.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { agreementLabel, diagnoseSeries, trendState } from "../src/lib/trendDiagnostics";

type Input = Record<string, { crypto?: boolean; close: number[] }>;

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  throw new Error("usage: exportTrendForecasts.ts <in.json> <out.json>");
}

const input = JSON.parse(readFileSync(inPath, "utf8")) as Input;
const out: Record<string, unknown> = {};

for (const [symbol, row] of Object.entries(input)) {
  const close = row.close.map((v) => Number(v));
  const bundle = diagnoseSeries(close, { crypto: Boolean(row.crypto) });
  const agree: (string | null)[] = [];
  const state: string[] = [];
  for (let i = 0; i < close.length; i++) {
    const ewmac = bundle.ewmac[i];
    const breakout = bundle.breakout[i];
    const accel = bundle.accel[i];
    const combined = bundle.combined[i];
    agree.push(agreementLabel(ewmac, breakout, accel, combined));
    state.push(trendState(ewmac, accel, breakout));
  }
  out[symbol] = { combined: bundle.combined, ewmac: bundle.ewmac, agree, state };
}

writeFileSync(outPath, JSON.stringify(out));
