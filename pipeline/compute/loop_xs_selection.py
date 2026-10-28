"""Cross-sectional LOOP sleeve selection.

When residual-strength coverage is wide enough, rank the tradable universe
by that percentile. A +4% day (watchlist state 1) only breaks ties.

Below the coverage floor, fall back to the gapper list: on-list, rank >= 60,
positive day, and positive relative volume. That keeps a thin tape from
letting one measured name reorder the book.

Exits are not decided here beyond the wide trail. A down close is not an exit.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Mapping, Sequence

TOP_N = 8
MAX_PER_SECTOR = 2
MIN_RANK = 60
RS_COVERAGE_MIN = 0.80


def rs_coverage_ratio(rows: Sequence[Mapping]) -> float:
    """Share of rows that carry a finite ``rs_pct``."""
    considered = [row for row in rows if row.get("symbol")]
    if not considered:
        return 0.0
    measured = sum(1 for row in considered if row.get("rs_pct") is not None)
    return measured / len(considered)


def rs_sort_enabled(rows: Sequence[Mapping]) -> bool:
    return rs_coverage_ratio(rows) >= RS_COVERAGE_MIN


def xs_eligible(row: Mapping, *, min_rank: int = MIN_RANK, require_rs: bool = False) -> bool:
    """Gapper gate, or residual-strength gate when ``require_rs`` is set."""
    if require_rs:
        return row.get("rs_pct") is not None
    if int(row.get("state") or 0) != 1:
        return False
    if int(row.get("quality_rank") or 0) < min_rank:
        return False
    if float(row.get("z_mom") or 0) <= 0:
        return False
    if float(row.get("f_ewmac") or 0) <= 0:
        return False
    return True


def _timing_flag(row_state: int) -> int:
    """0 sorts first. State 1 is the +4% / 2× volume day."""
    return 0 if row_state == 1 else 1


def select_xs_targets(
    radar_rows: Sequence[Mapping],
    sym_sector: Mapping[str, str],
    *,
    top_n: int = TOP_N,
    max_per_sector: int = MAX_PER_SECTOR,
    min_rank: int = MIN_RANK,
) -> list[str]:
    """Rank the eligible book.

    Residual strength leads only when at least ``RS_COVERAGE_MIN`` of the
    in-universe rows have ``rs_pct``. Otherwise the legacy quality-rank order
    is unchanged.
    """
    pool = [row for row in radar_rows if row.get("symbol") in sym_sector]
    use_rs = rs_sort_enabled(pool)
    cands: list[tuple[str, int, int, float, float | None, int]] = []
    for row in pool:
        sym = row.get("symbol")
        if not sym or not xs_eligible(row, min_rank=min_rank, require_rs=use_rs):
            continue
        raw_rs = row.get("rs_pct")
        rs = None if raw_rs is None else float(raw_rs)
        cands.append(
            (
                sym,
                int(row.get("quality_rank") or 0),
                int(row.get("convergence_count") or 0),
                float(row.get("f_ewmac") or 0),
                rs,
                _timing_flag(int(row.get("state") or 0)),
            )
        )

    def _key(item: tuple[str, int, int, float, float | None, int]):
        sym, rank, conv, ewmac, rs, timing = item
        if use_rs:
            return (-float(rs or 0.0), timing, -rank, -conv, -ewmac, sym)
        return (-rank, -conv, -ewmac, sym)

    cands.sort(key=_key)
    sector_count: dict[str, int] = defaultdict(int)
    out: list[str] = []
    for sym, _, _, _, _, _ in cands:
        sec = sym_sector.get(sym) or "Unknown"
        if sector_count[sec] >= max_per_sector:
            continue
        out.append(sym)
        sector_count[sec] += 1
        if len(out) >= top_n:
            break
    return out


def xs_hard_exit(row: Mapping | None) -> str | None:
    """A down day is not an exit. The sleeve holds through ordinary red closes."""
    del row
    return None


def xs_trail_exit(close: float | None, stop: float | None) -> str | None:
    """Exit only when price is through the wide trail. A zero stop is inactive."""
    if close is None or stop is None:
        return None
    if float(stop) <= 0:
        return None
    if float(close) < float(stop):
        return f"Wide trail · close {float(close):.2f} under stop {float(stop):.2f}"
    return None
