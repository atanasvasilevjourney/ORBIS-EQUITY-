"""MODULE 12 — Macro canaries → sector rotation → TEMA ensemble.

  1. Macro context   canary votes (basket proxies for QQQ/SPY, XLY/XLP, …)
  2. Rotation        GICS sector / industry trend tape
  3. TEMA ensemble   Fast/Slow TEMA-MACD grid inside aligned groups

9/99/199 swing stays a separate column. Paper only.

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

from pipeline.compute.canary_math import (
    build_canaries,
    equity_from_closes,
    group_aligned,
    tema_ensemble,
)
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


def _tape_row(run_id: str, t: GroupTape, now: str, aligned: bool) -> dict:
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
        "aligned": aligned,
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
        "symbol, date, high, low, close",
        order=("date", False),
    )
    by_sym: dict[str, list[tuple]] = defaultdict(list)
    for p in prices:
        if not p.get("symbol") or p.get("close") is None:
            continue
        c = float(p["close"])
        by_sym[p["symbol"]].append((
            p["date"],
            float(p.get("high") or c),
            float(p.get("low") or c),
            c,
        ))

    closes: dict[str, np.ndarray] = {}
    highs: dict[str, np.ndarray] = {}
    lows: dict[str, np.ndarray] = {}
    for sym, pts in by_sym.items():
        pts = sorted(pts)
        if len(pts) < LOOKBACK_MOM + 5:
            continue
        closes[sym] = np.array([x[3] for x in pts], dtype=float)
        highs[sym] = np.array([x[1] for x in pts], dtype=float)
        lows[sym] = np.array([x[2] for x in pts], dtype=float)

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
        return {"run_id": None, "groups": 0, "headline": "no groups", "regime": "NEUTRAL"}

    def _basket(names: list[str]) -> np.ndarray | None:
        mem = [closes[s] for s in names if s in closes]
        if len(mem) < 1:
            return None
        return equity_from_closes(mem)

    def_secs = {"Health Care", "Consumer Staples", "Utilities", "Real Estate"}
    baskets = {
        "univ": _basket(list(closes)),
        "tech": _basket([s for s, m in meta.items() if m.get("sector") == "Technology"]),
        "disc": _basket([s for s, m in meta.items() if m.get("sector") == "Consumer Discretionary"]),
        "staples": _basket([s for s, m in meta.items() if m.get("sector") == "Consumer Staples"]),
        "energy": _basket([s for s, m in meta.items() if m.get("sector") == "Energy"]),
        "defensive": _basket([s for s, m in meta.items() if m.get("sector") in def_secs]),
        "financials": _basket([s for s, m in meta.items() if m.get("sector") == "Financials"]),
    }
    canaries = build_canaries({k: v for k, v in baskets.items() if v is not None})
    rs_regime = rotation_regime(tapes)
    regime = canaries.regime

    aligned_map = {id(t): group_aligned(t.bucket, t.label, regime) for t in tapes}
    sector_of = {t.name: t for t in tapes if t.group_type == "sector"}
    industry_of = {t.name: t for t in tapes if t.group_type == "industry"}

    trigger_rows = []
    for sym, close in closes.items():
        info = meta.get(sym) or {}
        sector = info.get("sector") or "Other"
        industry = info.get("industry") or "Other"
        st = sector_of.get(sector)
        it = industry_of.get(industry)
        aligned = bool(
            (st and aligned_map.get(id(st))) or (it and aligned_map.get(id(it)))
        )
        ens = tema_ensemble(close, highs.get(sym), lows.get(sym))
        if ens.triggered == "FLAT":
            continue
        trigger_rows.append({
            "symbol": sym,
            "run_id": run_id,
            "sector": sector,
            "industry": industry,
            "ensemble": _round(ens.ensemble, 3),
            "n_long": ens.n_long,
            "n_short": ens.n_short,
            "n_cfg": ens.n_cfg,
            "triggered": ens.triggered,
            "tema_side": ens.tema_side,
            "tema_grade": ens.tema_grade,
            "macd_action": ens.macd_action,
            "aligned": aligned,
            "group_label": (it.label if it else None) or (st.label if st else None),
            "computed_at": None,  # filled below
        })

    sectors = sorted(
        [t for t in tapes if t.group_type == "sector"],
        key=lambda t: (-int(aligned_map.get(id(t), False)), -t.score),
    )
    lead = next((t for t in sectors if aligned_map.get(id(t))), None)
    if lead is None:
        lead = next((t for t in sectors if t.label in ("LEAD", "ACCEL")), sectors[0] if sectors else None)
    now = datetime.now(timezone.utc).isoformat()
    for r in trigger_rows:
        r["computed_at"] = now
    n_hit = sum(1 for r in trigger_rows if r["aligned"] and r["triggered"] == "LONG")
    bits = [f"{regime} ({canaries.n_on}↑/{canaries.n_off}↓ canaries)"]
    if lead:
        bits.append(f"{lead.name} {lead.label}")
    bits.append(f"TEMA ensemble {n_hit} aligned longs / {len(trigger_rows)} hits")
    headline = (
        f"{today.isoformat()} · {' · '.join(bits)} · "
        f"{len(sectors)} sectors / {sum(1 for t in tapes if t.group_type == 'industry')} industries"
    )

    rows = [_tape_row(run_id, t, now, aligned_map.get(id(t), False)) for t in tapes]
    canary_rows = [{
        "name": v.name,
        "run_id": run_id,
        "pair": v.pair,
        "z": _round(v.z, 3),
        "smooth": _round(v.smooth, 3),
        "vote": v.vote,
        "implication": v.implication,
        "proxy": v.proxy,
        "computed_at": now,
    } for v in canaries.votes]
    config = {
        "lookbackCurrent": LOOKBACK_CURRENT,
        "lookbackMom": LOOKBACK_MOM,
        "betaWindow": 60,
        "heatmapWeeks": 8,
        "leadBreadth": 0.65,
        "regime": regime,
        "rsRegime": rs_regime,
        "canaryScore": canaries.score,
        "marketR4": _round(market_r4, 5),
        "names": len(closes),
        "proxyCanaries": True,
    }
    sb.table("sector_rotation_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "names": len(closes),
        "n_sectors": len(sectors),
        "n_industries": sum(1 for t in tapes if t.group_type == "industry"),
        "regime": regime,
        "canary_score": canaries.score,
        "canary_on": canaries.n_on,
        "canary_off": canaries.n_off,
        "n_triggers": len(trigger_rows),
        "headline": headline,
        "config": config,
        "computed_at": now,
    }).execute()

    def _sync(table: str, rows_out: list[dict], key_cols: list[str]) -> None:
        existing = fetch_all(sb, table, ", ".join(key_cols))
        if len(key_cols) == 1:
            keep = {r[key_cols[0]] for r in rows_out}
            stale = [r for r in existing if r.get(key_cols[0]) not in keep]
        else:
            keep = {tuple(r[k] for k in key_cols) for r in rows_out}
            stale = [r for r in existing if tuple(r.get(k) for k in key_cols) not in keep]
        for i in range(0, len(rows_out), 40):
            sb.table(table).upsert(rows_out[i:i + 40]).execute()
        for r in stale:
            q = sb.table(table).delete()
            for k in key_cols:
                q = q.eq(k, r[k])
            q.execute()

    _sync("sector_rotation_groups", rows, ["group_type", "name"])
    _sync("sector_rotation_canaries", canary_rows, ["name"])
    _sync("sector_rotation_triggers", trigger_rows, ["symbol"])

    logger.info("Sector rotation wrote %d groups · %s", len(rows), headline)
    return {
        "run_id": run_id,
        "groups": len(rows),
        "headline": headline,
        "regime": regime,
        "n_sectors": len(sectors),
        "n_triggers": len(trigger_rows),
        "canary_score": canaries.score,
    }


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    print(run()["headline"])


if __name__ == "__main__":
    main()
