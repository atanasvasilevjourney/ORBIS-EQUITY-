"""Build weekly research pack from ORBIS Supabase tables."""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import yaml
from supabase import Client

from pipeline.research_framework.ideas import assemble_ideas, ideas_by_horizon, rank_short_candidates
from pipeline.research_framework.levels import round_px
from pipeline.utils.supabase import fetch_all

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config() -> dict:
    with CONFIG_PATH.open() as f:
        return yaml.safe_load(f) or {}


def _sma(close: np.ndarray, n: int) -> float:
    w = close[-n:] if len(close) >= n else close
    return float(np.mean(w)) if len(w) else 0.0


def build_macro_index(sb: Client, cfg: dict) -> dict:
    sym = cfg.get("index_symbol", "SPY")
    rows = fetch_all(
        sb,
        "prices_daily",
        "date, open, high, low, close",
        filters=lambda q: q.eq("symbol", sym),
        order=("date", True),
    )
    rows = rows[-280:]
    if len(rows) < 60:
        return {
            "symbol": sym,
            "asof_date": None,
            "headline": f"Insufficient {sym} history for macro summary.",
            "close": None,
            "sma200": None,
            "above_sma200": None,
            "support_zone": None,
            "resistance_zone": None,
            "narrative": [],
        }
    rows = sorted(rows, key=lambda r: r["date"])
    close = np.array([float(r["close"]) for r in rows if r.get("close") is not None])
    high = np.array([float(r["high"]) for r in rows if r.get("high") is not None])
    low = np.array([float(r["low"]) for r in rows if r.get("low") is not None])
    last = float(close[-1])
    sma200 = _sma(close, 200) if len(close) >= 200 else _sma(close, min(50, len(close)))
    above = last >= sma200
    recent_low = float(np.min(low[-20:]))
    recent_high = float(np.max(high[-20:]))
    narrative = [
        f"{sym} last {round_px(last)} vs SMA200 {round_px(sma200)} ({'above' if above else 'below'}).",
        f"20-session range {round_px(recent_low)}–{round_px(recent_high)} as support/resistance context.",
        "Pair price action with market internals on /status and breadth on ROTATE.",
    ]
    headline = (
        f"{sym} {'holds above' if above else 'trades below'} the 200-day average — "
        f"watch {round_px(recent_low)}–{round_px(recent_high)}."
    )
    return {
        "symbol": sym,
        "asof_date": rows[-1].get("date"),
        "headline": headline,
        "close": round_px(last),
        "sma200": round_px(sma200),
        "above_sma200": above,
        "support_zone": [round_px(recent_low), round_px(recent_low + (recent_high - recent_low) * 0.25)],
        "resistance_zone": [round_px(recent_high - (recent_high - recent_low) * 0.25), round_px(recent_high)],
        "narrative": narrative,
    }


def build_sector_context(sb: Client) -> list[dict]:
    runs = fetch_all(
        sb,
        "sector_rotation_runs",
        "run_id, asof_date, headline, regime",
        order=("computed_at", False),
    )
    runs = runs[:1]
    if not runs:
        return []
    run = runs[0]
    groups = fetch_all(
        sb,
        "sector_rotation_groups",
        "name, group_type, rs_4w, label, bucket, leaders, score",
        filters=lambda q: q.eq("run_id", run["run_id"]).eq("group_type", "sector"),
    )
    groups = sorted(groups, key=lambda g: -(g.get("score") or 0))[:6]
    out = []
    for g in groups:
        leaders = g.get("leaders") or []
        out.append(
            {
                "sector": g.get("name"),
                "label": g.get("label"),
                "bucket": g.get("bucket"),
                "rs_4w": g.get("rs_4w"),
                "leaders": leaders[:5],
            }
        )
    if run.get("headline"):
        out.insert(0, {"summary": run["headline"], "regime": run.get("regime"), "asof_date": run.get("asof_date")})
    return out


def _bars_by_symbol(sb: Client, symbols: set[str]) -> dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]]:
    if not symbols:
        return {}
    prices = fetch_all(sb, "prices_daily", "symbol, date, high, low, close")
    by: dict[str, list] = defaultdict(list)
    for p in prices:
        s = p.get("symbol")
        if s not in symbols or p.get("close") is None:
            continue
        by[s].append(p)
    out: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    for s, rows in by.items():
        rows = sorted(rows, key=lambda r: r["date"])[-120:]
        if len(rows) < 20:
            continue
        out[s] = (
            np.array([float(r["high"]) for r in rows]),
            np.array([float(r["low"]) for r in rows]),
            np.array([float(r["close"]) for r in rows]),
        )
    return out


def rank_candidates(sb: Client, cfg: dict) -> list[dict]:
    radar = {r["symbol"]: r for r in fetch_all(sb, "trend_radar", "symbol, state, quality_rank") if r.get("symbol")}
    fund = {
        r["symbol"]: r
        for r in fetch_all(
            sb,
            "fundamentals_snapshot",
            "symbol, company_name, sector, composite_factor_score, industry",
        )
        if r.get("symbol")
    }
    analysis = {
        r["symbol"]: r
        for r in fetch_all(sb, "analysis_names", "symbol, vote, buy_count, composite_score")
        if r.get("symbol")
    }
    min_q = int(cfg.get("min_trend_radar_quality", 65))
    min_f = int(cfg.get("min_composite_factor", 55))
    need_green = bool(cfg.get("prefer_trend_radar_green", True))
    need_buy = bool(cfg.get("require_analyze_buy_vote", True))

    scored: list[tuple[float, str]] = []
    for sym, tr in radar.items():
        q = tr.get("quality_rank") or 0
        if q < min_q:
            continue
        if need_green and tr.get("state") != 1:
            continue
        f = fund.get(sym, {})
        fs = f.get("composite_factor_score") or 0
        if fs and fs < min_f:
            continue
        an = analysis.get(sym, {})
        vote = (an.get("vote") or "").upper()
        if need_buy and "BUY" not in vote:
            continue
        score = float(q) * 0.5 + float(fs or an.get("composite_score") or 0) * 0.5
        scored.append((score, sym))
    scored.sort(reverse=True)
    return [{"symbol": s, "score": sc} for sc, s in scored[:80]]


def _carver_forecasts(sb: Client) -> tuple[dict[str, float], dict[str, float]]:
    """Cash desk + ROTATE Carver forecasts by symbol (negative → short fuel)."""
    cash_by: dict[str, float] = {}
    runs = fetch_all(sb, "perp_runs", "run_id", order=("computed_at", False))
    if runs:
        run_id = runs[0]["run_id"]
        for row in fetch_all(sb, "perp_names", "symbol, carver_forecast", filters=lambda q: q.eq("run_id", run_id)):
            sym = row.get("symbol")
            fc = row.get("carver_forecast")
            if sym and fc is not None:
                cash_by[sym] = float(fc)
    rotate_by: dict[str, float] = {}
    for row in fetch_all(sb, "sector_rotation_carver", "symbol, forecast"):
        sym = row.get("symbol")
        fc = row.get("forecast")
        if sym and fc is not None:
            rotate_by[sym] = float(fc)
    return cash_by, rotate_by


def generate_pack(sb: Client, cfg: dict | None = None) -> dict:
    cfg = cfg or load_config()
    macro = build_macro_index(sb, cfg)
    sectors = build_sector_context(sb)
    candidates = rank_candidates(sb, cfg)
    symbols = {c["symbol"] for c in candidates}
    bars = _bars_by_symbol(sb, symbols)
    fund = {
        r["symbol"]: r
        for r in fetch_all(
            sb,
            "fundamentals_snapshot",
            "symbol, company_name, sector, industry, composite_factor_score",
        )
        if r.get("symbol")
    }
    radar = {
        r["symbol"]: r
        for r in fetch_all(sb, "trend_radar", "symbol, state, quality_rank")
        if r.get("symbol")
    }
    analysis = {
        r["symbol"]: r
        for r in fetch_all(sb, "analysis_names", "symbol, vote, buy_count, composite_score")
        if r.get("symbol")
    }
    cash_fc, rotate_fc = _carver_forecasts(sb)
    short_pool = rank_short_candidates(radar, fund, analysis, cash_fc, rotate_fc, cfg)
    short_syms = {c["symbol"] for c in short_pool}
    symbols |= short_syms
    bars.update(_bars_by_symbol(sb, short_syms - set(bars.keys())))

    ideas = assemble_ideas(candidates, short_pool, bars, fund, radar, cfg)
    setups = ideas
    by_horizon = ideas_by_horizon(ideas)
    n_long = sum(1 for i in ideas if i.get("side") == "LONG")
    n_short = sum(1 for i in ideas if i.get("side") == "SHORT")

    week_end = date.today()
    headline = macro.get("headline") or "Weekly research pack"
    if ideas:
        headline = (
            f"{headline} · {len(ideas)} idea(s): {n_long} long / {n_short} short from ORBIS screens."
        )

    return {
        "week_ending": week_end.isoformat(),
        "headline": headline,
        "macro": macro,
        "sectors": sectors,
        "risk_notes": list(cfg.get("risk_notes") or []),
        "config": cfg,
        "setups": setups,
        "ideas": ideas,
        "horizons": by_horizon,
        "shorts": [i for i in ideas if i.get("side") == "SHORT"],
    }


def persist_pack(sb: Client, pack: dict) -> str:
    week = pack["week_ending"]
    run_id = f"rw-{week}-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    sb.table("research_weekly_runs").insert(
        {
            "run_id": run_id,
            "week_ending": week,
            "headline": pack.get("headline"),
            "macro": pack.get("macro") or {},
            "sectors": pack.get("sectors") or [],
            "risk_notes": pack.get("risk_notes") or [],
            "config": pack.get("config"),
        }
    ).execute()
    rows = []
    for i, s in enumerate(pack.get("setups") or [], start=1):
        rows.append(
            {
                "run_id": run_id,
                "rank": i,
                "symbol": s["symbol"],
                "company_name": s.get("company_name"),
                "source": s.get("source"),
                "theme": s.get("theme"),
                "side": s.get("side", "LONG"),
                "entry_px": s.get("entry_px"),
                "stop_px": s.get("stop_px"),
                "target_px": s.get("target_px"),
                "rr": s.get("rr"),
                "last_px": s.get("last_px"),
                "quality_rank": s.get("quality_rank"),
                "factor_score": s.get("factor_score"),
                "rationale": s.get("rationale"),
                "horizon": s.get("horizon") or "medium_term",
                "confidence": s.get("confidence"),
                "meta": s.get("meta") or {},
            }
        )
    if rows:
        sb.table("research_weekly_setups").insert(rows).execute()
    logger.info("Research weekly pack %s — %d setups", run_id, len(rows))
    return run_id


def run_cli() -> None:
    from pipeline.utils.run_recorded import run_recorded

    run_recorded("research_framework.weekly", lambda sb, _r: persist_pack(sb, generate_pack(sb, load_config())))
