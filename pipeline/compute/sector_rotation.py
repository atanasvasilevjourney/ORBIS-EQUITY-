"""MODULE 12 — Beta rotational sectors / industries.

Which GICS groups are trending: current + momentum breadth, weekly impulse,
60-day beta vs the equal-weight universe, 8-week heatmap.

Inspired by Caltropia's 2026 sector & industry outlook structure.
Computed on this universe — not their published tape. Paper only.

Usage:
    python -m pipeline.compute.sector_rotation
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import date, datetime, timezone

import numpy as np
from dotenv import load_dotenv
from supabase import create_client

from pipeline.compute.sector_math import (
    GroupTape,
    LOOKBACK_CURRENT,
    LOOKBACK_MOM,
    build_group_tape,
    daily_returns,
    equal_weight_returns,
    period_return,
    rotation_regime,
)
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _round(v: float | None, d: int = 4) -> float | None:
    if v is None or not np.isfinite(v):
        return None
    return round(float(v), d)


def _tape_row(run_id: str, t: GroupTape, now: str) -> dict:
    heat = [_round(x, 5) for x in t.heatmap]
    return {
        "run_id": run_id,
        "group_type": t.group_type,
        "name": t.name,
        "n_names": t.n_names,
        "tickers": t.tickers,
        "current_breadth": _round(t.current_breadth, 4),
        "mom_breadth": _round(t.mom_breadth, 4),
        "value_breadth": _round(t.value_breadth, 4) if t.value_breadth is not None else None,
        "lowvol_breadth": _round(t.lowvol_breadth, 4),
        "avg_trend": _round(t.avg_trend, 5),
        "impulse": _round(t.impulse, 5),
        "beta_60": _round(t.beta_60, 3),
        "rs_4w": _round(t.rs_4w, 5),
        "stretch_pct": _round(t.stretch_pct, 4),
        "label": t.label,
        "score": _round(t.score, 2),
        "bucket": t.bucket,
        "heatmap": heat,
        "leaders": t.leaders,
        "computed_at": now,
    }


def run() -> dict:
    today = date.today()
    run_id = f"r-{today.isoformat()}-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    sb = _sb()
    logger.info("=== Sector rotation (beta) start ===")

    uni = fetch_all(
        sb, "universe_members",
        "symbol, company_name, sector, industry",
        filters=lambda q: q.eq("is_active", True),
    )
    meta = {
        r["symbol"]: {
            "sector": r.get("sector") or "Other",
            "industry": r.get("industry") or "Other",
        }
        for r in uni if r.get("symbol")
    }
    funds = fetch_all(sb, "fundamentals_snapshot", "symbol, value_score")
    value_ok: dict[str, bool | None] = {r["symbol"]: None for r in funds if r.get("symbol")}
    for r in funds:
        vs = r.get("value_score")
        if r.get("symbol") and vs is not None:
            value_ok[r["symbol"]] = float(vs) >= 50

    prices = fetch_all(
        sb, "prices_daily",
        "symbol, date, close",
        order=("date", False),
    )
    by_sym: dict[str, list[tuple]] = defaultdict(list)
    for p in prices:
        if not p.get("symbol") or p.get("close") is None:
            continue
        by_sym[p["symbol"]].append((p["date"], float(p["close"])))

    closes: dict[str, np.ndarray] = {}
    for sym, pts in by_sym.items():
        pts = sorted(pts)
        if len(pts) < LOOKBACK_MOM + 5:
            continue
        closes[sym] = np.array([x[1] for x in pts], dtype=float)

    if len(closes) < 3:
        logger.warning("Sector rotation: too few names with history")
        return {"run_id": None, "groups": 0, "headline": "no names", "regime": "MIXED"}

    market_rets = equal_weight_returns(list(closes.values()))
    market_r4s = [period_return(c, LOOKBACK_CURRENT) for c in closes.values()]
    market_r4 = float(np.nanmean(market_r4s))
    vols = []
    for c in closes.values():
        d = daily_returns(c)
        if d.size >= LOOKBACK_CURRENT:
            vols.append(float(np.nanstd(d[-LOOKBACK_CURRENT:], ddof=0)))
    vol_median = float(np.nanmedian(vols)) if vols else float("nan")

    by_sector: dict[str, dict[str, np.ndarray]] = defaultdict(dict)
    ind_members: dict[str, dict[str, np.ndarray]] = defaultdict(dict)
    ind_sector: dict[str, str] = {}
    for sym, close in closes.items():
        info = meta.get(sym) or {}
        sector = info.get("sector") or "Other"
        industry = info.get("industry") or "Other"
        by_sector[sector][sym] = close
        ind_members[industry][sym] = close
        ind_sector.setdefault(industry, sector)

    tapes: list[GroupTape] = []
    for sector, members in by_sector.items():
        t = build_group_tape(
            group_type="sector",
            name=sector,
            sector_for_bucket=sector,
            members=members,
            market_rets=market_rets,
            market_r4=market_r4,
            vol_median=vol_median,
            value_ok=value_ok,
        )
        if t:
            tapes.append(t)
    for industry, members in ind_members.items():
        t = build_group_tape(
            group_type="industry",
            name=industry,
            sector_for_bucket=ind_sector.get(industry, "Other"),
            members=members,
            market_rets=market_rets,
            market_r4=market_r4,
            vol_median=vol_median,
            value_ok=value_ok,
        )
        if t:
            tapes.append(t)

    if not tapes:
        return {"run_id": None, "groups": 0, "headline": "no groups", "regime": "MIXED"}

    regime = rotation_regime(tapes)
    sectors = sorted(
        [t for t in tapes if t.group_type == "sector"],
        key=lambda t: -t.score,
    )
    lead = next((t for t in sectors if t.label in ("LEAD", "ACCEL")), sectors[0] if sectors else None)
    fade = next((t for t in sectors if t.label == "FADE"), None)
    now = datetime.now(timezone.utc).isoformat()
    bits = [regime]
    if lead:
        beta_s = f"{lead.beta_60:.2f}" if lead.beta_60 is not None else "—"
        bits.append(f"{lead.name} {lead.label} {lead.current_breadth*100:.0f}% breadth β {beta_s}")
    if fade:
        bits.append(f"{fade.name} FADE")
    headline = (
        f"{today.isoformat()} · {' · '.join(str(b) for b in bits)} · "
        f"{len(sectors)} sectors / {sum(1 for t in tapes if t.group_type == 'industry')} industries · "
        f"{len(closes)} names"
    )

    rows = [_tape_row(run_id, t, now) for t in tapes]
    config = {
        "lookbackCurrent": LOOKBACK_CURRENT,
        "lookbackMom": LOOKBACK_MOM,
        "betaWindow": 60,
        "heatmapWeeks": 8,
        "leadBreadth": 0.65,
        "regime": regime,
        "marketR4": _round(market_r4, 5),
        "names": len(closes),
    }
    sb.table("sector_rotation_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "names": len(closes),
        "n_sectors": len(sectors),
        "n_industries": sum(1 for t in tapes if t.group_type == "industry"),
        "regime": regime,
        "headline": headline,
        "config": config,
        "computed_at": now,
    }).execute()

    existing = fetch_all(sb, "sector_rotation_groups", "group_type, name")
    keep = {(r["group_type"], r["name"]) for r in rows}
    for i in range(0, len(rows), 40):
        sb.table("sector_rotation_groups").upsert(rows[i:i + 40]).execute()
    stale = [r for r in existing if (r.get("group_type"), r.get("name")) not in keep]
    for r in stale:
        sb.table("sector_rotation_groups").delete().eq("group_type", r["group_type"]).eq("name", r["name"]).execute()

    logger.info("Sector rotation wrote %d groups · %s", len(rows), headline)
    return {
        "run_id": run_id,
        "groups": len(rows),
        "headline": headline,
        "regime": regime,
        "n_sectors": len(sectors),
    }


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    print(run()["headline"])


if __name__ == "__main__":
    main()
