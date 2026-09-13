import assert from "node:assert/strict";
import {
  computePosture,
  liveTape,
  sectorsMatch,
} from "./sectorBreadth";

const uni = [
  { symbol: "JPM", sector: "Financials" },
  { symbol: "V", sector: "Financials" },
  { symbol: "EQIX", sector: "Real Estate" },
  { symbol: "AMT", sector: "Real Estate" },
  { symbol: "NFLX", sector: "Communication Services" },
  { symbol: "META", sector: "Communication Services" },
];
const radar = [
  { symbol: "JPM", state: 1, quality_rank: 70 },
  { symbol: "V", state: 1, quality_rank: 65 },
  { symbol: "EQIX", state: 0, quality_rank: 40 },
  { symbol: "AMT", state: 0, quality_rank: 38 },
  { symbol: "NFLX", state: -1, quality_rank: 20 },
  { symbol: "META", state: -1, quality_rank: 18 },
];

const tape = liveTape(radar, uni);
assert.equal(tape.bestSector, "Financials");
assert.equal(tape.bestSectorScore, 100);
assert.equal(tape.worstSector, "Communication Services");
assert.equal(tape.worstSectorScore, -100);
assert.equal(tape.sectors.find((s) => s.sector === "Real Estate")?.net, 0);
assert.equal(tape.pctGreen, 33.3);
assert.equal(tape.briefText, "Neutral - 33.3% GREEN, led by Financials");
assert.deepEqual(
  tape.sectors[0].names.map((n) => n.symbol),
  ["JPM", "V"]
);
assert.ok(tape.posture >= 40 && tape.posture < 75);

const stale30 = liveTape(
  Array.from({ length: 30 }, (_, i) => ({ symbol: String(i), state: i < 13 ? 1 : -1 })),
  Array.from({ length: 30 }, (_, i) => ({ symbol: String(i), sector: "X" }))
);
assert.equal(stale30.pctGreen, 43.3);
assert.equal(stale30.total, 30);
assert.notEqual(stale30.pctGreen, 43);

assert.equal(computePosture(tape.sectors, tape.pctGreen, tape.pctRed), tape.posture);
assert.ok(sectorsMatch("Real Estate", "real-estate"));
assert.ok(sectorsMatch("Communication Services", "CommunicationServices"));
assert.ok(!sectorsMatch("Real Estate", "Financials"));

console.log("sectorBreadth live tape ok", {
  best: tape.bestSector,
  brief: tape.briefText,
  posture: tape.posture,
  stale30: stale30.pctGreen,
});
