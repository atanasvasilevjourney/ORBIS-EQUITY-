"""Market breadth and posture aggregates.

Reads trend_radar + universe_members, computes:
  - % universe GREEN / RED / GREY
  - Per-sector breadth (net state count)
  - Market posture score (0-100)
  - Delta vs 5d ago
  - Best/worst sectors

Stores results in daily_brief table as inputs for the AI brief generator.

Usage:
    python -m pipeline.compute.aggregates
"""
import json
import logging
import os
from collections import Counter
from datetime import date

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
logger = logging.getLogger(__name__)


def compute_breadth(radar_rows: list[dict], universe_rows: list[dict]) -> dict:
    """Compute breadth metrics from trend_radar data."""
    # Build symbol→sector map
    sector_map = {r["symbol"]: r.get("sector", "Unknown") for r in universe_rows}

    total = len(radar_rows)
    if total == 0:
        return {"pct_green": 0, "pct_red": 0, "pct_grey": 0, "total": 0}

    states = Counter(r["state"] for r in radar_rows)
    greens = states.get(1, 0)
    reds = states.get(-1, 0)
    greys = states.get(0, 0)

    # Per-sector breadth
    sector_states: dict[str, dict] = {}
    for r in radar_rows:
        sector = sector_map.get(r["symbol"], "Unknown")
        if sector not in sector_states:
            sector_states[sector] = {"green": 0, "red": 0, "grey": 0, "total": 0}
        sector_states[sector]["total"] += 1
        if r["state"] == 1:
            sector_states[sector]["green"] += 1
        elif r["state"] == -1:
            sector_states[sector]["red"] += 1
        else:
            sector_states[sector]["grey"] += 1

    # Net score per sector (green% - red%)
    sector_scores = {}
    for sector, counts in sector_states.items():
        if counts["total"] > 0:
            net = (counts["green"] - counts["red"]) / counts["total"]
            sector_scores[sector] = round(net * 100, 1)

    # Sort sectors by score
    sorted_sectors = sorted(sector_scores.items(), key=lambda x: x[1], reverse=True)
    best_sector = sorted_sectors[0] if sorted_sectors else ("—", 0)
    worst_sector = sorted_sectors[-1] if sorted_sectors else ("—", 0)

    return {
        "total": total,
        "greens": greens,
        "reds": reds,
        "greys": greys,
        "pct_green": round(greens / total * 100, 1),
        "pct_red": round(reds / total * 100, 1),
        "pct_grey": round(greys / total * 100, 1),
        "sector_breadth": sector_scores,
        "best_sector": best_sector[0],
        "best_sector_score": best_sector[1],
        "worst_sector": worst_sector[0],
        "worst_sector_score": worst_sector[1],
    }


def compute_posture(breadth: dict) -> int:
    """Market posture score 0-100.

    Components:
      - 50% net breadth: (green% - red%) mapped from [-100,+100] to [0,50]
      - 30% green strength: green% mapped from [0,100] to [0,30]
      - 20% sector uniformity: fraction of sectors with positive net score
    """
    green_pct = breadth.get("pct_green", 0)
    red_pct = breadth.get("pct_red", 0)

    # Net breadth (0-50): centers at 25 when green=red
    net_breadth = green_pct - red_pct  # range: -100 to +100
    net_score = ((net_breadth + 100) / 200) * 50

    # Green strength (0-30)
    green_score = (green_pct / 100) * 30

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
    sb_key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sb_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
        return

    sb = create_client(sb_url, sb_key)

    # Fetch all trend_radar rows
    radar = sb.table("trend_radar").select("symbol,state,quality_rank").execute()
    universe = sb.table("universe_members").select("symbol,sector,tier,country").eq("is_active", True).execute()

    if not radar.data:
        logger.warning("No trend_radar data found. Run trend_radar compute first.")
        return

    logger.info(f"Computing aggregates for {len(radar.data)} tickers")

    # Compute breadth
    breadth = compute_breadth(radar.data, universe.data)
    posture = compute_posture(breadth)
    label = compute_posture_label(posture)

    # Per-region breadth
    region_map = {}
    for u in universe.data:
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
        region_rows = [r for r in radar.data if r["symbol"] in region_symbols]
        if region_rows:
            total = len(region_rows)
            greens = sum(1 for r in region_rows if r["state"] == 1)
            region_breadth[region] = round(greens / total * 100, 1)

    # Average quality rank
    avg_rank = round(sum(r["quality_rank"] for r in radar.data) / len(radar.data), 1)

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
        "brief": f"{label} - {breadth['pct_green']}% GREEN, led by {breadth['best_sector']}",
        "inputs": json.dumps(summary),
        "model": "aggregates_v1",
    }, on_conflict="asof_date").execute()

    logger.info(
        f"Posture: {posture} ({label}) | "
        f"GREEN: {breadth['pct_green']}% | RED: {breadth['pct_red']}% | "
        f"Best: {breadth['best_sector']} ({breadth['best_sector_score']}) | "
        f"Worst: {breadth['worst_sector']} ({breadth['worst_sector_score']})"
    )
    logger.info(f"Region breadth: {region_breadth}")


if __name__ == "__main__":
    main()
