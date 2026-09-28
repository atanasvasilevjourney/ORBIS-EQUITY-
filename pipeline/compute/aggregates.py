"""Market breadth and posture aggregates.

Reads the module-1 watchlist (`trend_radar`) plus universe membership.

Posture is the share of names up on the day (`z_mom` = day percent change).
It is not the size of the hot list, so a short watchlist does not shut off
other modules that read `daily_brief.posture_score`.

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


def compute_posture(breadth: dict) -> int:
    """Market posture 0-100 = percent of names up on the day.

    Falls back to the older GREEN/RED mix only when day-change breadth is absent.
    """
    if "advancers_pct" in breadth:
        return int(min(max(round(float(breadth["advancers_pct"])), 0), 100))

    green_pct = breadth.get("pct_green", 0)
    red_pct = breadth.get("pct_red", 0)

    # Net breadth (0-50): centers at 25 when green=red
    net_breadth = green_pct - red_pct  # range: -100 to +100
    net_score = ((net_breadth + 100) / 200) * 50

    # Directional strength (0-30): symmetric — centers at 15 when green=red
    total_directional = green_pct + red_pct
    if total_directional > 0:
        direction_ratio = (green_pct - red_pct) / total_directional  # [-1, +1]
    else:
        direction_ratio = 0
    green_score = ((direction_ratio + 1) / 2) * 30

    # Sector uniformity (0-20): how many sectors are net positive
    sector_breadth = breadth.get("sector_breadth", {})
    if sector_breadth:
        positive_sectors = sum(1 for v in sector_breadth.values() if v > 0)
        uniformity = positive_sectors / len(sector_breadth)
        uniformity_score = uniformity * 20
    else:
        uniformity_score = 10

    raw = net_score + green_score + uniformity_score
    return int(min(max(round(raw), 0), 100))


def compute_posture_label(score: int) -> str:
    """Map posture score to label."""
    if score >= 75:
        return "Bullish"
    elif score >= 60:
        return "Slight Bullish"
    elif score >= 40:
        return "Neutral"
    elif score >= 25:
        return "Slight Bearish"
    else:
        return "Bearish"


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    sb_url = os.getenv("SUPABASE_URL", "")
    sb_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
        return

    sb = create_client(sb_url, sb_key)

    from pipeline.utils.supabase import fetch_all

    radar_data = fetch_all(sb, "trend_radar", "symbol,state,quality_rank,z_mom")
    universe_data = fetch_all(
        sb,
        "universe_members",
        "symbol,sector,tier,country",
        filters=lambda q: q.eq("is_active", True),
    )

    if not radar_data:
        logger.warning("No trend_radar data found. Run trend_radar compute first.")
        return

    logger.info(f"Computing aggregates for {len(radar_data)} tickers")

    # Compute breadth
    breadth = compute_breadth(radar_data, universe_data)
    posture = compute_posture(breadth)
    label = compute_posture_label(posture)

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

    # Build summary
    summary = {
        "posture_score": posture,
        "posture_label": label,
        "breadth": breadth,
        "region_breadth": region_breadth,
        "avg_quality_rank": avg_rank,
        "computed_at": date.today().isoformat(),
    }

    # Store in daily_brief as inputs
    sb.table("daily_brief").upsert({
        "asof_date": date.today().isoformat(),
        "brief": (
            f"{label} — {breadth.get('advancers_pct', 0)}% of names up, "
            f"{breadth.get('greens', 0)} on the watchlist, "
            f"led by {breadth['best_sector']}"
        ),
        "inputs": summary,
        "model": "aggregates_v1",
    }, on_conflict="asof_date").execute()

    logger.info(
        f"Posture: {posture} ({label}) | "
        f"Advancers: {breadth.get('advancers_pct', 0)}% | Watchlist: {breadth.get('greens', 0)} | "
        f"Best: {breadth['best_sector']} ({breadth['best_sector_score']}) | "
        f"Worst: {breadth['worst_sector']} ({breadth['worst_sector_score']})"
    )
    logger.info(f"Region breadth: {region_breadth}")


if __name__ == "__main__":
    main()
