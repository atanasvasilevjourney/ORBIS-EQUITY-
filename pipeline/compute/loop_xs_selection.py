"""Cross-sectional LOOP v2 candidate selection (Trend Radar watchlist semantics)."""
from __future__ import annotations

from collections import defaultdict
from typing import Mapping, Sequence

TOP_N = 8
MAX_PER_SECTOR = 2
MIN_RANK = 60


def xs_eligible(row: Mapping, *, min_rank: int = MIN_RANK) -> bool:
    if int(row.get("state") or 0) != 1:
        return False
    if int(row.get("quality_rank") or 0) < min_rank:
        return False
    if float(row.get("z_mom") or 0) <= 0:
        return False
    if float(row.get("f_ewmac") or 0) <= 0:
        return False
    return True


def select_xs_targets(
    radar_rows: Sequence[Mapping],
    sym_sector: Mapping[str, str],
    *,
    top_n: int = TOP_N,
    max_per_sector: int = MAX_PER_SECTOR,
    min_rank: int = MIN_RANK,
) -> list[str]:
    """Rank by quality_rank, convergence_count, relative volume (f_ewmac)."""
    cands: list[tuple[str, int, int, float]] = []
    for row in radar_rows:
        sym = row.get("symbol")
        if not sym or sym not in sym_sector:
            continue
        if not xs_eligible(row, min_rank=min_rank):
            continue
        cands.append(
            (
                sym,
                int(row.get("quality_rank") or 0),
                int(row.get("convergence_count") or 0),
                float(row.get("f_ewmac") or 0),
            )
        )
    cands.sort(key=lambda x: (-x[1], -x[2], -x[3], x[0]))
    sector_count: dict[str, int] = defaultdict(int)
    out: list[str] = []
    for sym, _, _, _ in cands:
        sec = sym_sector.get(sym) or "Unknown"
        if sector_count[sec] >= max_per_sector:
            continue
        out.append(sym)
        sector_count[sec] += 1
        if len(out) >= top_n:
            break
    return out


def xs_hard_exit(row: Mapping | None) -> str | None:
    """Mandatory exit: watchlist down-day (state RED / -1)."""
    if row is None:
        return None
    if int(row.get("state") or 0) == -1:
        return "Watchlist down day (state RED)"
    return None
