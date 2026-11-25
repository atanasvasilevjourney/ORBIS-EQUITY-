"""Market breadth and posture aggregates.

Reads the module-1 watchlist (`trend_radar`) plus universe membership.

Posture is a weighted composite (see ``shared/posture_composite.json`` and
``pipeline.compute.posture_composite``). Breadth still tracks day change via
``z_mom`` on the watchlist table.

Also reports how many names are on the watchlist (`state == 1`) and which
sectors led or lagged by average day change.

Usage:
    python -m pipeline.compute.aggregates
"""
import logging
import os
from collections import Counter
from datetime import date

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
logger = logging.getLogger(__name__)


def _day_pct(row: dict) -> float:
    try:
        return float(row.get("z_mom") or 0)
    except (TypeError, ValueError):
        return 0.0


def compute_breadth(radar_rows: list[dict], universe_rows: list[dict]) -> dict:
    """Breadth from the watchlist table.

    `state == 1` counts names on the hot list. Day direction comes from `z_mom`
    (percent change). Sector score is the average day change, not GREEN/RED mix.
    """
    sector_map = {r["symbol"]: r.get("sector", "Unknown") for r in universe_rows}

    total = len(radar_rows)
    if total == 0:
        return {
            "pct_green": 0,
            "pct_red": 0,
            "pct_grey": 0,
            "advancers_pct": 0,
            "total": 0,
            "greens": 0,
            "reds": 0,
            "greys": 0,
        }

    states = Counter(r.get("state") for r in radar_rows)
    on_list = states.get(1, 0)
    down = states.get(-1, 0)
    idle = states.get(0, 0)
    ups = sum(1 for r in radar_rows if _day_pct(r) > 0)

    sector_changes: dict[str, list[float]] = {}
    for r in radar_rows:
        sector = sector_map.get(r["symbol"], "Unknown")
        sector_changes.setdefault(sector, []).append(_day_pct(r))

    sector_scores = {
        sector: round(sum(vals) / len(vals), 2)
        for sector, vals in sector_changes.items()
        if vals
    }
    sorted_sectors = sorted(sector_scores.items(), key=lambda x: x[1], reverse=True)
    best_sector = sorted_sectors[0] if sorted_sectors else ("—", 0)
    worst_sector = sorted_sectors[-1] if sorted_sectors else ("—", 0)

    return {
        "total": total,
        "greens": on_list,
        "reds": down,
        "greys": idle,
        "pct_green": round(on_list / total * 100, 1),
        "pct_red": round(down / total * 100, 1),
        "pct_grey": round(idle / total * 100, 1),
        "advancers_pct": round(ups / total * 100, 1),
        "sector_breadth": sector_scores,
        "best_sector": best_sector[0],
        "best_sector_score": best_sector[1],
        "worst_sector": worst_sector[0],
        "worst_sector_score": worst_sector[1],
    }


def radar_aux_pillars(breadth: dict, radar_rows: list[dict], avg_rank: float) -> dict:
    """Watchlist participation / leadership (not part of composite weights)."""
    total = len(radar_rows) or 1
    adv = float(breadth.get("advancers_pct", 0))
    on_list_pct = float(breadth.get("pct_green", 0))
    leaders = sum(1 for r in radar_rows if (r.get("quality_rank") or 0) >= 70)
    leadership = round(leaders / total * 100, 1)
    participation = int(min(max(round(on_list_pct), 0), 100))
    trend_rank = int(min(max(round(avg_rank), 0), 100))
    heat_cap = int(min(100, max(15, round(adv - max(0, trend_rank - leadership) * 0.35))))
    return {
        "leadership": int(leadership),
        "participation": participation,
        "heat_cap_pct": heat_cap,
    }


def main():
    from pipeline.utils.run_recorded import run_recorded

    run_recorded("compute.aggregates", _run_aggregates)


def _latest_price_session(sb) -> date:
    """Latest ``prices_daily`` session (trading date for posture as-of)."""
    try:
        resp = (
            sb.table("prices_daily")
            .select("date")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows and rows[0].get("date"):
            return date.fromisoformat(str(rows[0]["date"])[:10])
    except Exception:
        logger.warning("Could not read latest prices_daily date", exc_info=True)
    return date.today()


def _run_aggregates(sb, run) -> None:
    from datetime import timedelta

    from pipeline.compute.posture_composite import (
        build_price_frames,
        compute_posture_bundle,
        fetch_gex_sign,
    )
    from pipeline.utils.supabase import fetch_all, fetch_prices_since

    trading_asof = _latest_price_session(sb)

    radar_data = fetch_all(sb, "trend_radar", "symbol,state,quality_rank,z_mom")
    universe_data = fetch_all(
        sb,
        "universe_members",
        "symbol,sector,tier,country",
        filters=lambda q: q.eq("is_active", True),
    )

    if not radar_data:
        logger.warning("No trend_radar data found. Run trend_radar compute first.")
        run.mark_partial("no trend_radar rows")
        return

    logger.info(f"Computing aggregates for {len(radar_data)} tickers")

    # Compute breadth
    breadth = compute_breadth(radar_data, universe_data)

    cutoff = (trading_asof - timedelta(days=285)).isoformat()
    px_rows = fetch_prices_since(sb, cutoff, select="symbol,date,close,high,low")
    active_syms = [u["symbol"] for u in universe_data if u.get("symbol")]
    px_rows = [r for r in px_rows if r.get("symbol") in set(active_syms)]
    frames = build_price_frames(px_rows)
    index_frames = {
        sym: frames[sym]
        for sym in ("SPY", "QQQ", "VIX", "^VIX", "VIX3M", "^VIX3M")
        if sym in frames
    }
    composite = compute_posture_bundle(
        universe_symbols=active_syms,
        price_rows=px_rows,
        index_frames=index_frames,
        advancers_pct=float(breadth.get("advancers_pct", 0)),
        gex_sign=fetch_gex_sign(),
    )
    posture = int(composite["posture_score"])
    label = str(composite["posture_label"])

    # Per-region breadth
    region_map = {}
    for u in universe_data:
        sym = u["symbol"]
        country = u.get("country", "")
        if country == "US":
            region_map[sym] = "US"
        elif country == "GB":
            region_map[sym] = "UK"
        elif country in ("DE", "FR", "NL", "ES", "IT", "CH", "IE"):
            region_map[sym] = "EU"
        else:
            region_map[sym] = "Other"

    region_breadth = {}
    for region in ["US", "UK", "EU", "Other"]:
        region_symbols = {s for s, r in region_map.items() if r == region}
        region_rows = [r for r in radar_data if r["symbol"] in region_symbols]
        if region_rows:
            ups = sum(1 for r in region_rows if _day_pct(r) > 0)
            region_breadth[region] = round(ups / len(region_rows) * 100, 1)

    # Average quality rank
    avg_rank = round(sum(r["quality_rank"] for r in radar_data) / len(radar_data), 1)
    aux = radar_aux_pillars(breadth, radar_data, avg_rank)
    pillars = {**composite["posture_pillars"], **aux}
    pillars["participation"] = aux["participation"]
    pillars["leadership"] = aux["leadership"]

    # Build summary
    summary = {
        "posture_score": posture,
        "posture_label": label,
        "posture_basis": "composite",
        "posture_pillars": pillars,
        "posture_composite": composite,
        "breadth": breadth,
        "region_breadth": region_breadth,
        "avg_quality_rank": avg_rank,
        "computed_at": date.today().isoformat(),
        "trading_date": trading_asof.isoformat(),
        "breadth_asof": trading_asof.isoformat(),
    }

    # Store in daily_brief as inputs
    sb.table("daily_brief").upsert({
        "asof_date": trading_asof.isoformat(),
        "brief": (
            f"{label} — {breadth.get('advancers_pct', 0)}% of names up, "
            f"{breadth.get('greens', 0)} on the watchlist, "
            f"led by {breadth['best_sector']}"
        ),
        "inputs": summary,
        "model": "aggregates_v2_composite",
    }, on_conflict="asof_date").execute()

    logger.info(
        f"Posture: {posture} ({label}) | "
        f"Advancers: {breadth.get('advancers_pct', 0)}% | Watchlist: {breadth.get('greens', 0)} | "
        f"Best: {breadth['best_sector']} ({breadth['best_sector_score']}) | "
        f"Worst: {breadth['worst_sector']} ({breadth['worst_sector_score']})"
    )
    logger.info(f"Region breadth: {region_breadth}")
    run.set_headline(f"{label} · posture {posture} · {len(radar_data)} names")
    run.set_row_counts(names=len(radar_data))


if __name__ == "__main__":
    main()
