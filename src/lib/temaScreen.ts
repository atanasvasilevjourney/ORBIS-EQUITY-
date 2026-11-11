/** Long-only TEMA screen. A name is on or off. Nothing here assigns a size. */

import { ema, tema } from "@/lib/tema";

export const SCREEN_PAIRS = [
  [8, 21, 9],
  [12, 50, 9],
  [8, 63, 9],
] as const;

export const SCREEN_REGIME = 199;
export const SCREEN_ENTRY_VOTES = 2;

export type TemaScreenState = {
  on: boolean;
  votes: number;
  distance: number;
  histograms: [boolean, boolean, boolean];
};

export function stickyLong(regimeUp: boolean[], votes: number[], start = SCREEN_REGIME, entryVotes = SCREEN_ENTRY_VOTES): boolean[] {
  const pos = new Array<boolean>(regimeUp.length).fill(false);
  let holding = false;
  for (let i = Math.max(0, start); i < regimeUp.length; i++) {
    if (holding) {
      if (!regimeUp[i]) holding = false;
    } else if (regimeUp[i] && votes[i] >= entryVotes) {
      holding = true;
    }
    pos[i] = holding;
  }
  return pos;
}

function histogram(close: number[], fast: number, slow: number, signal: number): number[] {
  const fastLine = tema(close, fast);
  const slowLine = tema(close, slow);
  const line = fastLine.map((value, i) => value - slowLine[i]);
  const sig = ema(line, signal);
  return line.map((value, i) => value - sig[i]);
}

/** Last bar of one close series. Null when TEMA-199 has no room to exist. */
export function screenClose(close: number[]): TemaScreenState | null {
  if (close.length <= SCREEN_REGIME) return null;
  const regime = tema(close, SCREEN_REGIME);
  const hists = SCREEN_PAIRS.map(([fast, slow, signal]) => histogram(close, fast, slow, signal));
  const votes = close.map((_, i) => hists.reduce((sum, hist) => sum + (hist[i] > 0 ? 1 : 0), 0));
  const regimeUp = close.map((px, i) => px > regime[i]);
  const held = stickyLong(regimeUp, votes);
  const i = close.length - 1;
  const slow = regime[i];
  return {
    on: held[i],
    votes: votes[i],
    distance: slow ? close[i] / slow - 1 : 0,
    histograms: [hists[0][i] > 0, hists[1][i] > 0, hists[2][i] > 0],
  };
}
