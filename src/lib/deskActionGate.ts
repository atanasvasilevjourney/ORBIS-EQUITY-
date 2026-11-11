import type { CockpitDeskSummaries } from "@/lib/cockpitDeskSummaries";

/** Zero trade counts when the tape is stale. Informational desks stay visible. */
export function gateCockpitActionable(
  desks: CockpitDeskSummaries,
  suppressed: boolean
): CockpitDeskSummaries {
  if (!suppressed) return desks;
  return {
    ...desks,
    orbBreakouts: 0,
    analysisBuys: 0,
    analysisSells: 0,
    biasLongs: 0,
    biasShorts: 0,
    cashTema: 0,
    cashCarver: 0,
    triangleBreakouts: 0,
  };
}
