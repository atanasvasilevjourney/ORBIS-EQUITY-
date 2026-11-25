/** Breadth block shared by dashboard and summary (watchlist vs true advancers). */

export type BreadthCounts = {
  total: number;
  /** Names on module-1 watchlist (+4% day, 2× rel vol). */
  onList: number;
  onListPct: number;
  /** Names with down day from latest session close. */
  downDay: number;
  downDayPct: number;
  /** Watchlist names on a down day (state -1). */
  onListDown: number;
  onListDownPct: number;
  /** Share of universe up on the latest session. */
  advancersPct: number;
  /** @deprecated Use onList — legacy field name for watchlist count. */
  greens: number;
  /** @deprecated Use onListDown — legacy field name. */
  reds: number;
  /** @deprecated Use onListPct. */
  pctGreen: number;
  /** @deprecated Use onListDownPct. */
  pctRed: number;
};

export function buildBreadthBlock(input: {
  total: number;
  onList: number;
  onListDown: number;
  downDay: number;
  advancers: number;
}): BreadthCounts {
  const { total, onList, onListDown, downDay, advancers } = input;
  return {
    total,
    onList,
    onListPct: total > 0 ? Math.round((onList / total) * 100) : 0,
    downDay,
    downDayPct: total > 0 ? Math.round((downDay / total) * 100) : 0,
    onListDown,
    onListDownPct: total > 0 ? Math.round((onListDown / total) * 100) : 0,
    advancersPct: total > 0 ? Math.round((advancers / total) * 100) : 0,
    greens: onList,
    reds: onListDown,
    pctGreen: total > 0 ? Math.round((onList / total) * 100) : 0,
    pctRed: total > 0 ? Math.round((onListDown / total) * 100) : 0,
  };
}