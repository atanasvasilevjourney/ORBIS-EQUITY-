"""Rank long/short research ideas with transparent Iskrel rules and evidence marks."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from pipeline.research_framework.levels import long_setup_from_bars, short_setup_from_bars

EvidenceMark = str  # SOURCED | CALCULATED | ASSUMED
HORIZONS = ("short_term", "medium_term", "long_term")
CONFIDENCE = ("High", "Med", "Low")


def _confidence(n_rules: int) -> str:
    if n_rules >= 3:
        return "High"
    if n_rules == 2:
        return "Med"
    return "Low"


def _long_horizon(quality: int | None, factor: int | None, cfg: dict) -> str:
    q_thr = int(cfg.get("long_term_min_quality", 82))
    f_thr = int(cfg.get("long_term_min_factor", 68))
    q = quality or 0
    f = factor or 0
    if q >= q_thr and f >= f_thr:
        return "long_term"
    return "medium_term"


def short_rules(
    sym: str,
    *,
    radar: dict,
    fund: dict,
    analysis: dict,
    carver_fc: float | None,
    rotate_fc: float | None,
    cfg: dict,
) -> tuple[list[str], list[str], bool]:
    """Return (rule_ids, sources, enough)."""
    weak_max = int(cfg.get("max_composite_factor_short", 48))
    rules: list[str] = []
    sources: list[str] = []

    state = radar.get("state")
    if state == -1:
        rules.append("trend_radar_red")
        sources.append("trend_radar")

    fs = fund.get("composite_factor_score")
    if fs is not None and fs <= weak_max:
        rules.append("weak_composite_factor")
        sources.append("fundamentals_snapshot")

    vote = (analysis.get("vote") or "").upper()
    if "SELL" in vote:
        rules.append("analyze_sell_vote")
        sources.append("analysis_names")

    if carver_fc is not None and carver_fc < 0:
        rules.append("negative_carver_cash_forecast")
        sources.append("perp_names.carver_forecast")

    if rotate_fc is not None and rotate_fc < 0:
        rules.append("negative_rotate_carver_forecast")
        sources.append("sector_rotation_carver.forecast")

    min_rules = int(cfg.get("short_min_rules", 2))
    return rules, sources, len(rules) >= min_rules


def build_idea(
    *,
    symbol: str,
    direction: str,
    horizon: str,
    levels: dict[str, float],
    company_name: str,
    theme: str,
    rationale: str,
    sources: list[str],
    wrong_test: str,
    rules: list[str],
    rank_score: float,
    quality_rank: int | None = None,
    factor_score: int | None = None,
    extra_meta: dict | None = None,
) -> dict[str, Any]:
    entry = levels["entry_px"]
    band = float(levels.get("atr") or 0) * 0.15
    entry_zone = [round(entry - band, 4), round(entry + band, 4)]
    n_rules = len(rules)
    evidence: dict[str, EvidenceMark] = {
        "ticker": "SOURCED",
        "direction": "CALCULATED",
        "horizon": "CALCULATED",
        "entry_zone": "CALCULATED",
        "stop_invalidation": "CALCULATED",
        "target": "CALCULATED",
        "confidence": "CALCULATED",
        "rationale": "CALCULATED",
        "sources": "SOURCED",
        "wrong_test": "ASSUMED",
        "rules_triggered": "SOURCED",
    }
    for src in sources:
        evidence[src] = "SOURCED"

    meta = {
        "rank_score": rank_score,
        "rules_triggered": rules,
        "entry_zone": entry_zone,
        "wrong_test": wrong_test,
        "sources": sorted(set(sources)),
        "evidence": evidence,
    }
    if extra_meta:
        meta.update(extra_meta)

    return {
        "symbol": symbol,
        "company_name": company_name,
        "source": "+".join(sorted(set(sources)))[:120],
        "theme": theme,
        "side": direction,
        "horizon": horizon,
        "confidence": _confidence(n_rules if direction == "SHORT" else max(n_rules, 2)),
        "direction": direction,
        "entry_zone": entry_zone,
        **levels,
        "quality_rank": quality_rank,
        "factor_score": factor_score,
        "rationale": rationale,
        "wrong_test": wrong_test,
        "sources": sorted(set(sources)),
        "meta": meta,
    }


def rank_short_candidates(
    radar: dict[str, dict],
    fund: dict[str, dict],
    analysis: dict[str, dict],
    carver_by_sym: dict[str, float],
    rotate_fc_by_sym: dict[str, float],
    cfg: dict,
) -> list[dict]:
    """Transparent short screen — mirror of long filters, inverted."""
    max_q = int(cfg.get("max_trend_radar_quality_short", 55))
    scored: list[tuple[float, str, list[str]]] = []
    for sym, tr in radar.items():
        q = tr.get("quality_rank") or 0
        if q > max_q:
            continue
        rules, sources, ok = short_rules(
            sym,
            radar=tr,
            fund=fund.get(sym, {}),
            analysis=analysis.get(sym, {}),
            carver_fc=carver_by_sym.get(sym),
            rotate_fc=rotate_fc_by_sym.get(sym),
            cfg=cfg,
        )
        if not ok:
            continue
        f = fund.get(sym, {})
        fs = f.get("composite_factor_score") or 0
        an = analysis.get(sym, {})
        penalty = float(q) * 0.3
        boost = len(rules) * 12.0
        score = boost + max(0, max_q - q) * 0.5 + max(0, (cfg.get("max_composite_factor_short", 48) - (fs or 50))) * 0.3
        scored.append((score - penalty * 0.1, sym, rules))
    scored.sort(reverse=True)
    return [{"symbol": s, "score": sc, "rules": r} for sc, s, r in scored[: int(cfg.get("short_candidate_pool", 40))]]


def assemble_ideas(
    candidates_long: list[dict],
    candidates_short: list[dict],
    bars: dict,
    fund: dict[str, dict],
    radar: dict[str, dict],
    cfg: dict,
) -> list[dict]:
    ideas: list[dict] = []
    max_long = int(cfg.get("max_setups", 5))
    max_short = int(cfg.get("max_short_setups", 3))
    max_per_sector = int(cfg.get("max_per_sector", 2))
    sector_counts: dict[str, int] = defaultdict(int)

    for cand in candidates_long:
        sym = cand["symbol"]
        f = fund.get(sym, {})
        sec = (f.get("sector") or "unknown").lower()
        if sector_counts[sec] >= max_per_sector:
            continue
        b = bars.get(sym)
        if not b:
            continue
        hi, lo, cl = b
        levels = long_setup_from_bars(
            hi,
            lo,
            cl,
            entry_mode=str(cfg.get("entry_mode", "breakout_prior_high")),
            stop_atr_mult=float(cfg.get("stop_atr_mult", 1.5)),
            target_atr_mult=float(cfg.get("target_atr_mult", 2.0)),
            atr_period=int(cfg.get("atr_period", 14)),
        )
        if not levels:
            continue
        tr = radar.get(sym, {})
        q = tr.get("quality_rank")
        fs = f.get("composite_factor_score")
        horizon = _long_horizon(q, fs, cfg)
        rules = ["trend_radar_green", "composite_factor", "analyze_buy_vote"]
        rationale = (
            f"Iskrel long: radar quality {q or '—'}, factor {fs or '—'}, ANALYZE BUY. "
            f"Breakout entry at prior high; ATR stop/target ({horizon.replace('_', ' ')})."
        )
        wrong = f"Invalid if {sym} closes below stop ({levels['stop_px']}) before entry triggers."
        ideas.append(
            build_idea(
                symbol=sym,
                direction="LONG",
                horizon=horizon,
                levels=levels,
                company_name=f.get("company_name") or "",
                theme=_theme_for(sym, f),
                rationale=rationale,
                sources=["trend_radar", "fundamentals_snapshot", "analysis_names"],
                wrong_test=wrong,
                rules=rules,
                rank_score=cand["score"],
                quality_rank=q,
                factor_score=fs,
            )
        )
        sector_counts[sec] += 1
        if sum(1 for i in ideas if i["side"] == "LONG") >= max_long:
            break

    short_sectors: dict[str, int] = defaultdict(int)
    for cand in candidates_short:
        if sum(1 for i in ideas if i["side"] == "SHORT") >= max_short:
            break
        sym = cand["symbol"]
        f = fund.get(sym, {})
        sec = (f.get("sector") or "unknown").lower()
        if short_sectors[sec] >= max_per_sector:
            continue
        b = bars.get(sym)
        if not b:
            continue
        hi, lo, cl = b
        levels = short_setup_from_bars(
            hi,
            lo,
            cl,
            entry_mode=str(cfg.get("short_entry_mode", "breakdown_prior_low")),
            stop_atr_mult=float(cfg.get("stop_atr_mult", 1.5)),
            target_atr_mult=float(cfg.get("target_atr_mult", 2.0)),
            atr_period=int(cfg.get("atr_period", 14)),
        )
        if not levels:
            continue
        tr = radar.get(sym, {})
        rules = cand.get("rules") or []
        rule_txt = ", ".join(rules)
        rationale = (
            f"Iskrel short: rules [{rule_txt}]. Breakdown entry at prior low; "
            f"ATR stop above / target below (short-term)."
        )
        wrong = f"Invalid if {sym} reclaims stop ({levels['stop_px']}) or trend radar flips GREEN."
        src_map = {
            "trend_radar_red": "trend_radar",
            "weak_composite_factor": "fundamentals_snapshot",
            "analyze_sell_vote": "analysis_names",
            "negative_carver_cash_forecast": "perp_names.carver_forecast",
            "negative_rotate_carver_forecast": "sector_rotation_carver.forecast",
        }
        sources = [src_map.get(r, r) for r in rules]
        ideas.append(
            build_idea(
                symbol=sym,
                direction="SHORT",
                horizon="short_term",
                levels=levels,
                company_name=f.get("company_name") or "",
                theme=_theme_for(sym, f),
                rationale=rationale,
                sources=sources,
                wrong_test=wrong,
                rules=rules,
                rank_score=cand["score"],
                quality_rank=tr.get("quality_rank"),
                factor_score=f.get("composite_factor_score"),
            )
        )
        short_sectors[sec] += 1

    return ideas


def _theme_for(symbol: str, fund: dict) -> str:
    sector = (fund.get("sector") or "").strip()
    industry = (fund.get("industry") or "").strip()
    if sector and industry:
        return f"{sector} · {industry}"
    return sector or industry or "multi-factor"


def ideas_by_horizon(ideas: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {h: [] for h in HORIZONS}
    for idea in ideas:
        h = idea.get("horizon") or "medium_term"
        if h in out:
            out[h].append(idea)
    return out