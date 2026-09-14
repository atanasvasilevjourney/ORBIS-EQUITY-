import assert from "node:assert/strict";
import { toEpochMs, toVelaBars, velaTimeframe } from "../src/lib/chart/velaBars.ts";

assert.equal(toEpochMs("2026-09-11"), Date.parse("2026-09-11T00:00:00.000Z"));
assert.equal(toEpochMs(1_757_596_800), 1_757_596_800_000);
assert.equal(toEpochMs(1_757_596_800_000), 1_757_596_800_000);
assert.equal(toEpochMs("2026-09-11 23:55:00.000000"), Date.parse("2026-09-11T23:55:00.000Z"));
assert.equal(velaTimeframe("5m"), "5");
assert.equal(velaTimeframe("1d"), "D");

const bars = toVelaBars([
  { time: "2026-09-10", open: 1, high: 2, low: 0.5, close: 1.5 },
  { time: "2026-09-11", open: 1.5, high: 2.2, low: 1.4, close: 2 },
  { time: "2026-09-11", open: 9, high: 9, low: 9, close: 9 },
]);
assert.equal(bars.length, 2);
assert.equal(bars[0].time, Date.parse("2026-09-10T00:00:00.000Z"));
assert.ok(bars[1].time > bars[0].time);

console.log("velaBars ok", bars.length, velaTimeframe("5m"));
