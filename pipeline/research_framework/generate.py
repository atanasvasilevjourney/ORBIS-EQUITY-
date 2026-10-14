"""Generate weekly research pack from ORBIS Supabase snapshots.

Usage:
    python -m pipeline.research_framework.generate
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import date, datetime, timezone

import numpy as np
from dotenv import load_dotenv
from supabase import Client, create_client

from pipeline.research_framework.rules import (
    build_breakout_setup,
    build_macro_view,
    load_config,
    rank_setups,
    score_candidate,
    theme_bucket,
    week_start_for,
)
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)


def _sb() -> Client:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _price_bars(sb: Client, symbols: list[str]) -> dict[str, tuple[np.ndarray, np.ndarray, np.ndarray, str | None]]:
    if not symbols:
        return {}
    sym_set = set(symbols)
    rows = fetch_all(
        sb,
        "prices_daily",
        "symbol, date, open, high, low, close, adj_close",
        filters=lambda q: q.in_("symbol", list(sym_set)),
        order=("date", False),
    )
    by_sym: dict[str, list[tuple]] = defaultdict(list)
    last_date: dict[str, str | None] = {}
    for p in rows:
        sym = p.get("symbol")
        if not sym or sym not in sym_set:
            continue
        c = p.get("adj_close") if p.get("adj_close") is not None else p.get("close")
        if c is None:
            continue
        by_sym[sym].append(
            (
                p["date"],
                float(p.get("open") or c),
                float(p.get("high") or c),
                float(p.get("low") or c),
                float(c),
            )
        )
        last_date[sym] = str(p["date"])[:10]

    out: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray, str | None]] = {}
    for sym, pts in by_sym.items():
        pts = sorted(pts)
        if len(pts) < 30:
            continue
        close = np.array([x[4] for x in pts], dtype=float)
        high = np.array([x[2] for x in pts], dtype=float)
        low = np.array([x[3] for x in pts], dtype=float)
        out[sym] = (close, high, low, last_date.get(sym))
    return out


def _macro_section(sb: Client, cfg: dict) -> tuple[list[dict], date | None]:
    macro_cfg = cfg.get("macro") or {}
    benchmarks = macro_cfg.get("benchmarks") or [{"symbol": "SPY", "label": "S&P 500"}]
    syms = [b["symbol"] for b in benchmarks if b.get("symbol")]
    bars = _price_bars(sb, syms)
    views: list[dict] = []
    asof: date | None = None
    ma_period = int(macro_cfg.get("ma200_period", 200))
    swing_lb = int(macro_cfg.get("swing_lookback", 40))
    min_bars = int(macro_cfg.get("min_history_bars", 220))
    for b in benchmarks:
        sym = b.get("symbol")
        if not sym or sym not in bars:
            continue
        close, high, low, px_date = bars[sym]
        if len(close) < min_bars:
            continue
        view = build_macro_view(
            close,
            high,
            low,
            symbol=sym,
            label=str(b.get("label") or sym),
            ma_period=ma_period,
            swing_lookback=swing_lb,
        )
        if view:
            views.append(view)
            if px_date:
                try:
                    d = date.fromisoformat(px_date[:10])
                    asof = d if asof is None or d > asof else asof
                except ValueError:
                    pass
    return views, asof


def _internals_section(sb: Client, cfg: dict) -> dict:
    out: dict = {}
    if (cfg.get("internals") or {}).get("use_daily_brief", True):
        rows = fetch_all(sb, "daily_brief", "asof_date, brief, inputs", order=("asof_date", True))
        if rows:
            latest = rows[0]
            inputs = latest.get("inputs") if isinstance(latest.get("inputs"), dict) else {}
            out["dailyBrief"] = {
                "asOfDate": latest.get("asof_date"),
                "briefText": latest.get("brief"),
                "postureLabel": inputs.get("posture_label"),
                "postureScore": inputs.get("posture_score"),
                "bestSector": (inputs.get("breadth") or {}).get("best_sector"),
                "worstSector": (inputs.get("breadth") or {}).get("worst_sector"),
            }
    if (cfg.get("internals") or {}).get("use_trend_radar_breadth", True):
        radar = fetch_all(sb, "trend_radar", "state, quality_rank, z_mom")
        total = len(radar)
        greens = sum(1 for r in radar if r.get("state") == 1)
        adv = sum(1 for r in radar if (r.get("z_mom") or 0) > 0)
        out["trendRadar"] = {
            "universe": total,
            "onList": greens,
            "onListPct": round(100 * greens / total, 1) if total else 0,
            "advancersPct": round(100 * adv / total, 1) if total else 0,
        }
    return out


def _sector_rotation_section(sb: Client, cfg: dict) -> dict:
    rot_cfg = cfg.get("sector_rotation") or {}
    top_n = int(rot_cfg.get("top_groups", 3))
    runs = fetch_all(
        sb,
        "sector_rotation_runs",
        "run_id, asof_date, headline",
        order=("asof_date", True),
    )
    if not runs:
        return {}
    latest = runs[0]
    run_id = latest.get("run_id")
    groups = fetch_all(sb, "sector_rotation_groups", "name, group_type, rs_4w, label, score, run_id")
    mine = [g for g in groups if g.get("run_id") == run_id]
    types = rot_cfg.get("group_types") or ["sector"]
    mine = [g for g in mine if g.get("group_type") in types]
    mine.sort(key=lambda g: -(g.get("rs_4w") or 0))
    leaders = [
        {
            "name": g.get("name"),
            "rs4w": g.get("rs_4w"),
            "label": g.get("label"),
            "score": g.get("score"),
        }
        for g in mine[:top_n]
    ]
    laggards = sorted(mine, key=lambda g: (g.get("rs_4w") or 0))[:top_n]
    return {
        "asOfDate": latest.get("asof_date"),
        "headline": latest.get("headline"),
        "leaders": leaders,
        "laggards": [
            {"name": g.get("name"), "rs4w": g.get("rs_4w"), "label": g.get("label")} for g in laggards
        ],
    }


def _build_setups(sb: Client, cfg: dict, asof: date | None) -> list[dict]:
    setup_cfg = cfg.get("setups") or {}
    themes = cfg.get("themes") or {}
    radar_rows = fetch_all(
        sb,
        "trend_radar",
        "symbol, state, quality_rank, z_mom, breakout_active, volume_confirmed, computed_at",
    )
    fund_rows = fetch_all(sb, "fundamentals_snapshot", "symbol, composite_factor_score, sector")
    uni_rows = fetch_all(
        sb,
        "universe_members",
        "symbol, company_name, sector, industry",
        filters=lambda q: q.eq("is_active", True),
    )
    funds = {r["symbol"]: r for r in fund_rows if r.get("symbol")}
    uni = {r["symbol"]: r for r in uni_rows if r.get("symbol")}

    candidates: list[dict] = []
    pre_syms: list[str] = []
    for r in radar_rows:
        sym = r.get("symbol")
        if not sym:
            continue
        _, ok = score_candidate(r, funds.get(sym), setup_cfg)
        if ok:
            pre_syms.append(sym)

    bars = _price_bars(sb, pre_syms[:200])
    rules = setup_cfg.get("rules") or {}
    stop_m = float(rules.get("stop_atr_mult", 0.75))
    tgt_m = float(rules.get("target_atr_mult", 1.5))
    min_rr = float(rules.get("min_rr", 1.2))
    min_hist = int(setup_cfg.get("min_history_bars", 60))

    for r in radar_rows:
        sym = r.get("symbol")
        if not sym or sym not in bars:
            continue
        score, ok = score_candidate(r, funds.get(sym), setup_cfg)
        if not ok or score is None:
            continue
        close, high, low, _ = bars[sym]
        if len(close) < min_hist:
            continue
        setup = build_breakout_setup(
            close, high, low, stop_atr_mult=stop_m, target_atr_mult=tgt_m, min_rr=min_rr
        )
        if not setup:
            continue
        u = uni.get(sym) or {}
        f = funds.get(sym) or {}
        sector = u.get("sector") or f.get("sector")
        bucket = theme_bucket(sector, themes)
        rationale = (
            f"ORBIS score {score} · radar state {r.get('state')} · quality rank {r.get('quality_rank')} · "
            f"{setup['kind']} · {setup['trigger']}"
        )
        candidates.append(
            {
                "symbol": sym,
                "companyName": u.get("company_name") or "",
                "sector": sector,
                "themeBucket": bucket,
                "deskSource": "trend_radar",
                "orbisScore": score,
                "qualityRank": r.get("quality_rank"),
                "compositeFactor": f.get("composite_factor_score"),
                **setup,
                "rationale": rationale,
                "rules": {
                    "stopAtrMult": stop_m,
                    "targetAtrMult": tgt_m,
                    "minRr": min_rr,
                    "noTradeUntilEntry": (setup_cfg.get("validation") or {}).get("no_trade_until_entry", True),
                },
            }
        )

    return rank_setups(candidates, int(setup_cfg.get("max_count", 5)))


def run() -> dict:
    cfg = load_config()
    sb = _sb()
    logger.info("=== Weekly research pack start ===")

    macro, asof = _macro_section(sb, cfg)
    internals = _internals_section(sb, cfg)
    rotation = _sector_rotation_section(sb, cfg)
    setups = _build_setups(sb, cfg, asof)

    if asof is None:
        asof = date.today()
    week_start = week_start_for(asof)
    pack_id = f"weekly-{week_start.isoformat()}"
    risk = cfg.get("risk") or {}

    headline_parts = []
    if macro:
        headline_parts.append(macro[0].get("narrative", "")[:120])
    headline_parts.append(f"{len(setups)} setups (paper)")
    headline = " · ".join(p for p in headline_parts if p)

    pack_row = {
        "pack_id": pack_id,
        "week_start": week_start.isoformat(),
        "asof_date": asof.isoformat(),
        "headline": headline,
        "macro": macro,
        "internals": internals,
        "sector_rotation": rotation,
        "risk_notes": {
            "riskPerTradePct": risk.get("risk_per_trade_pct"),
            "maxConcurrent": risk.get("max_concurrent_setups"),
            "trailingStopHint": risk.get("trailing_stop_hint"),
            "monthlyPlMindset": risk.get("monthly_pl_mindset"),
        },
        "config_version": cfg.get("version", 1),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }

    sb.table("research_weekly_pack").upsert(pack_row).execute()

    setup_rows = []
    for s in setups:
        setup_rows.append(
            {
                "pack_id": pack_id,
                "rank": s["rank"],
                "symbol": s["symbol"],
                "company_name": s.get("companyName"),
                "theme_bucket": s.get("themeBucket"),
                "desk_source": s.get("deskSource"),
                "side": s.get("side"),
                "entry": s.get("entry"),
                "stop": s.get("stop"),
                "target": s.get("target"),
                "rr": s.get("rr"),
                "orbis_score": s.get("orbisScore"),
                "status": s.get("status", "pending"),
                "rationale": s.get("rationale"),
                "rules": s.get("rules"),
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    sb.table("research_setups").delete().eq("pack_id", pack_id).execute()
    for i in range(0, len(setup_rows), 40):
        sb.table("research_setups").upsert(setup_rows[i : i + 40]).execute()

    logger.info("Research pack %s · %d setups · %s", pack_id, len(setup_rows), headline)
    return {"pack_id": pack_id, "setups": len(setup_rows), "headline": headline}


def main() -> None:
    from pipeline.utils.run_recorded import run_recorded

    def _body(_sb: Client, rec) -> None:
        result = run()
        rec.set_headline(str(result.get("headline", "")))
        rec.set_row_counts(names=int(result.get("setups", 0)))
        print(result["headline"])

    run_recorded("research_framework.generate", _body)


if __name__ == "__main__":
    main()
