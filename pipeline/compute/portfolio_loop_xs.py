"""LOOP v2 cross-sectional paper harness (sector-residual sleeve).

  Universe   active LOOP-tradable members, excluding SPY
  Entry      Residual strength vs the name's sector when coverage is at least 80%.
             A +4% / 2× volume day breaks ties. Below that coverage, fall back
             to the on-list gapper gate.
  Gate       posture ≥ 50 and SPY regime buys_allowed (SMA200 + vol)
  Exit       Wide SMA20 trail, or drop from the top basket on the 5-session
             rebalance. A down close alone does not sell.
  Size       Equal weight, max 8 names, max 2 / sector

Writes paper_loop_xs_runs / paper_book_xs / paper_orders_xs. Does not touch Donchian LOOP book.
``paper_book_xs.n`` stores the residual percentile.

Usage:
    python -m pipeline.compute.portfolio_loop_xs
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta, timezone

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

from pipeline.compute.donchian_vwap import (
    EQUITY,
    MAX_PER_SECTOR,
    MIN_NOTIONAL,
    MIN_PRICE,
    REBALANCE_DAYS,
    TOP_N,
)
from pipeline.compute.loop_order_economics import next_session_open, order_economics
from pipeline.compute.loop_xs_selection import (
    RS_COVERAGE_MIN,
    rs_coverage_ratio,
    select_xs_targets,
    xs_trail_exit,
)
from pipeline.compute.market_regime import regime_signal
from pipeline.compute.relative_strength import RS_LOOKBACK, RS_SKIP_RECENT, rs_percentiles_from_frames
from pipeline.compute.trail_exit import replay_wide_stop
from pipeline.universe_filters import is_loop_tradable, is_pharma_stock
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)

POSTURE_ENTRY_MIN = 50
# 63-session relative strength needs lookback+1 bars. 220 calendar days
# covers that plus holidays; 90 calendar days does not.
PRICE_HISTORY_DAYS = 220


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _parse_date(v) -> date | None:
    if not v:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _should_rebalance(today: date, last_rebalance: date | None) -> bool:
    if last_rebalance is None:
        return True
    return (today - last_rebalance).days >= REBALANCE_DAYS


def _spy_buys_allowed(px_rows: list[dict]) -> tuple[bool, dict]:
    if not px_rows:
        return True, {"note": "no SPY tape"}
    df = pd.DataFrame(px_rows).sort_values("date")
    df = df.set_index(pd.to_datetime(df["date"]))
    try:
        reg = regime_signal(df.rename(columns=str.lower))
    except ValueError:
        return True, {"note": "insufficient SPY history for regime"}
    return bool(reg.get("buys_allowed")), reg


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Portfolio Loop XS (cross-sectional watchlist) ===")
    sb = _sb()
    from pipeline.utils.pipeline_runs import PipelineRunRecorder

    with PipelineRunRecorder(sb, "compute.portfolio_loop_xs", asof_date=date.today()) as run:
        _run(sb, run)


def _run(sb, run) -> None:
    today = date.today()
    run_id = f"xs_{today.isoformat()}_{datetime.now(timezone.utc).strftime('%H%M%S')}"
    now = datetime.now(timezone.utc).isoformat()
    log: list[dict] = []

    def note(level: str, message: str) -> None:
        log.append({"at": now, "level": level, "message": message})
        logger.info("%s %s", level, message)

    universe = fetch_all(
        sb,
        "universe_members",
        "symbol, company_name, sector, industry, tier, is_active",
        filters=lambda q: q.eq("is_active", True),
    )
    uni = {r["symbol"]: r for r in universe if is_loop_tradable(r)}
    sym_sector = {s: (uni[s].get("sector") or "Unknown") for s in uni}

    try:
        book_rows = fetch_all(sb, "paper_book_xs", "*")
    except Exception as exc:
        msg = str(exc)
        if "paper_book_xs" in msg and ("PGRST205" in msg or "schema cache" in msg):
            raise SystemExit(
                "paper_book_xs not found — apply supabase/migrations/033_paper_loop_xs.sql "
                "in Supabase, then re-run: python -m pipeline.compute.portfolio_loop_xs"
            ) from exc
        raise
    brief_rows = fetch_all(sb, "daily_brief", "asof_date, inputs")
    prior_runs = fetch_all(
        sb,
        "paper_loop_xs_runs",
        "asof_date, harness",
        order=("computed_at", True),
    )
    radar_rows = fetch_all(
        sb,
        "trend_radar",
        "symbol, state, quality_rank, z_mom, f_ewmac, convergence_count, entry_timing",
    )
    radar_by_sym = {r["symbol"]: r for r in radar_rows if r.get("symbol")}

    posture = 50
    if brief_rows:
        latest = sorted(brief_rows, key=lambda x: str(x.get("asof_date") or ""), reverse=True)[0]
        inputs = latest.get("inputs") or {}
        if isinstance(inputs, dict):
            posture = int(inputs.get("posture_score") or 50)

    last_rebalance: date | None = None
    for pr in reversed(prior_runs or []):
        h = pr.get("harness") or {}
        if isinstance(h, dict) and h.get("lastRebalanceDate"):
            last_rebalance = _parse_date(h["lastRebalanceDate"])
            if last_rebalance:
                break

    do_rebalance = _should_rebalance(today, last_rebalance)
    cutoff = (today - timedelta(days=PRICE_HISTORY_DAYS)).isoformat()
    all_px = fetch_all(
        sb,
        "prices_daily",
        "symbol,date,open,high,low,close,adj_close,volume",
        filters=lambda q: q.gte("date", cutoff),
        order=("symbol", False),
    )
    spy_px = [r for r in all_px if r.get("symbol") == "SPY"]
    buys_allowed, regime = _spy_buys_allowed(spy_px)

    from pipeline.utils.price_series import ohlcv_frame

    px_by_sym: dict[str, pd.DataFrame] = {}
    last_close: dict[str, float] = {}
    if all_px:
        px_df = pd.DataFrame(all_px)
        for sym, g in px_df.groupby("symbol"):
            if sym in uni or sym == "SPY":
                frame = ohlcv_frame(g.to_dict("records"))
                px_by_sym[sym] = frame
                if len(frame):
                    last_close[sym] = float(frame.iloc[-1]["close"])

    peer_frames = {
        sym: frame for sym, frame in px_by_sym.items() if sym in uni and sym != "SPY"
    }
    rs_map = rs_percentiles_from_frames(
        peer_frames,
        lookback=RS_LOOKBACK,
        skip_recent=RS_SKIP_RECENT,
        as_of=today,
        benchmark=px_by_sym.get("SPY"),
        sectors=sym_sector,
    )
    candidates = []
    for row in radar_rows:
        sym = row.get("symbol")
        if sym not in uni or sym == "SPY":
            continue
        tagged = dict(row)
        if sym in rs_map:
            tagged["rs_pct"] = rs_map[sym]
        candidates.append(tagged)
    rs_coverage = rs_coverage_ratio(candidates)

    note(
        "INFO",
        f"XS start · ${EQUITY:,.0f} · {len(book_rows)} open · posture {posture} · "
        f"regime buys={buys_allowed} · rebalance={'yes' if do_rebalance else 'no'}",
    )

    orders: list[dict] = []
    oid = 0

    def add_order(
        *,
        ticker: str,
        action: str,
        type: str,
        shares: int,
        limit_price: float | None,
        reason: str,
        sector: str,
        ohlcv: pd.DataFrame | None = None,
        use_next_open: bool = False,
    ) -> None:
        nonlocal oid
        oid += 1
        fill_px = limit_price
        fill_mode = "eod_close"
        if use_next_open and action == "BUY":
            nopen, mode = next_session_open(ohlcv, today)
            if nopen is not None:
                fill_px = nopen
                fill_mode = mode
        econ = order_economics(shares, limit_price, fill_price=fill_px, fill_mode=fill_mode)
        orders.append({
            "id": f"{run_id}_ord_{oid:03d}",
            "run_id": run_id,
            "ticker": ticker,
            "action": action,
            "type": type,
            "shares": shares,
            "limit_price": limit_price,
            "reason": reason,
            "sector": sector,
            "risk_usd": None,
            **econ,
        })

    held = {p["symbol"]: p for p in book_rows}
    surviving: dict[str, dict] = {}
    trailed_out: set[str] = set()
    trail_stops: dict[str, float] = {}

    for sym, pos in list(held.items()):
        shares = int(pos.get("shares") or 0)
        sector = pos.get("sector") or sym_sector.get(sym, "")
        u_row = uni.get(sym) or pos
        exit_reason = None
        if is_pharma_stock(u_row) or sym not in uni:
            exit_reason = "Universe policy · not in LOOP universe"
        else:
            opened = _parse_date(pos.get("opened_at"))
            entry_px = float(pos.get("entry") or last_close.get(sym) or 0)
            stop = _hold_trail_stop(px_by_sym.get(sym), entry_px, opened)
            trail_stops[sym] = stop
            exit_reason = xs_trail_exit(last_close.get(sym), stop)
        snap_price = last_close.get(sym)
        if exit_reason:
            if exit_reason.startswith("Wide trail"):
                trailed_out.add(sym)
            add_order(
                ticker=sym,
                action="SELL",
                type="EXIT",
                shares=shares,
                limit_price=round(snap_price, 2) if snap_price else None,
                reason=exit_reason,
                sector=sector,
            )
            note("ORDER", f"EXIT {sym} · {exit_reason}")
            held.pop(sym, None)

    target_syms: list[str] = []
    if do_rebalance:
        if posture < POSTURE_ENTRY_MIN:
            note("WARN", f"Posture {posture} < {POSTURE_ENTRY_MIN} — skip rebalance entries")
        elif not buys_allowed:
            note("WARN", "Regime gate off — skip rebalance entries")
        else:
            target_syms = [
                sym for sym in select_xs_targets(candidates, sym_sector) if sym not in trailed_out
            ]
            mode = "sector residual" if rs_coverage >= RS_COVERAGE_MIN else "gapper fallback"
            note(
                "INFO",
                f"XS rebalance target ({len(target_syms)}) · {mode} · "
                f"coverage {rs_coverage:.0%}: {target_syms}",
            )

        if target_syms:
            for sym in list(held.keys()):
                if sym in target_syms:
                    continue
                pos = held[sym]
                px = last_close.get(sym)
                add_order(
                    ticker=sym,
                    action="SELL",
                    type="EXIT",
                    shares=int(pos.get("shares") or 0),
                    limit_price=round(px, 2) if px else None,
                    reason="Rebalance · dropped from top basket",
                    sector=pos.get("sector") or "",
                )
                held.pop(sym, None)
        elif do_rebalance and held:
            note("INFO", f"Rebalance skipped rotate-out · 0 targets · keeping {len(held)} open")

    for sym, pos in held.items():
        px = last_close.get(sym)
        entry = float(pos.get("entry") or px or 0)
        last = float(px or entry)
        opened = _parse_date(pos.get("opened_at")) or today
        u = uni.get(sym) or {}
        shares = int(pos.get("shares") or 0)
        surviving[sym] = _book_row(
            sym, u, pos, shares, entry, last, run_id, now, today, opened,
            rs_pct=rs_map.get(sym),
            stop=trail_stops.get(sym),
        )

    if do_rebalance and posture >= POSTURE_ENTRY_MIN and buys_allowed and target_syms:
        slot_equity = EQUITY / len(target_syms)
        for sym in target_syms:
            u = uni.get(sym)
            if not u:
                continue
            price = last_close.get(sym)
            ohlcv_sym = px_by_sym.get(sym)
            if price is None or price < MIN_PRICE:
                continue
            entry_px = price
            nopen, _ = next_session_open(ohlcv_sym, today)
            if nopen is not None:
                entry_px = nopen
            shares = int(slot_equity // price)
            if shares < 1 or shares * price < MIN_NOTIONAL:
                continue
            if sym in trailed_out:
                continue
            rad = radar_by_sym.get(sym) or {}
            rank = int(rad.get("quality_rank") or 0)
            rs = rs_map.get(sym)
            timing = " · +4% day" if int(rad.get("state") or 0) == 1 else ""
            if rs is not None:
                reason = f"Sector RS {rs:.0f}{timing}"
            else:
                reason = f"XS rank {rank}{timing}"
            sector = u.get("sector") or "Unknown"
            if sym in surviving and surviving[sym]["shares"] == shares:
                continue
            if sym in surviving:
                delta = shares - surviving[sym]["shares"]
                if delta > 0:
                    add_order(
                        ticker=sym,
                        action="BUY",
                        type="RESIZE",
                        shares=delta,
                        limit_price=round(price, 2),
                        reason=reason,
                        sector=sector,
                        ohlcv=ohlcv_sym,
                        use_next_open=True,
                    )
                elif delta < 0:
                    add_order(
                        ticker=sym,
                        action="SELL",
                        type="RESIZE",
                        shares=-delta,
                        limit_price=round(price, 2),
                        reason=reason,
                        sector=sector,
                    )
            else:
                add_order(
                    ticker=sym,
                    action="BUY",
                    type="ENTER",
                    shares=shares,
                    limit_price=round(price, 2),
                    reason=reason,
                    sector=sector,
                    ohlcv=ohlcv_sym,
                    use_next_open=True,
                )
            surviving[sym] = _book_row(
                sym, u, {}, shares, entry_px, price, run_id, now, today, today, reason, rank,
                rs_pct=rs,
                stop=_hold_trail_stop(ohlcv_sym, entry_px, today),
            )

    surviving_list = list(surviving.values())
    deployed = sum((p["last"] or 0) * p["shares"] for p in surviving_list)
    deployed_pct = deployed / EQUITY if EQUITY else 0

    harness = {
        "sectorExposure": _sector_exposure(surviving_list, EQUITY),
        "lastRebalanceDate": today.isoformat() if do_rebalance else (
            last_rebalance.isoformat() if last_rebalance else None
        ),
        "config": {
            "engine": "loop_xs_watchlist",
            "maxNames": TOP_N,
            "maxPerSector": MAX_PER_SECTOR,
            "rebalanceDays": REBALANCE_DAYS,
            "minRank": 60,
            "rsLookback": RS_LOOKBACK,
            "rsSkipRecent": RS_SKIP_RECENT,
            "rsCoverage": round(rs_coverage, 4),
            "rsCoverageMin": RS_COVERAGE_MIN,
            "rsMode": "sector_residual" if rs_coverage >= RS_COVERAGE_MIN else "gapper_fallback",
            "regimeGate": True,
            "buysAllowed": buys_allowed,
            "regime": regime,
        },
    }

    n_enter = sum(1 for o in orders if o["type"] == "ENTER")
    n_exit = sum(1 for o in orders if o["type"] == "EXIT")
    headline = (
        f"XS · {n_exit} exit · {n_enter} enter · deployed {deployed_pct * 100:.1f}%"
    )

    sb.table("paper_loop_xs_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "equity": EQUITY,
        "deployed_pct": round(deployed_pct, 4),
        "open_risk_pct": round(deployed_pct, 4),
        "names": len(surviving_list),
        "posture": posture,
        "status": "OK",
        "headline": headline,
        "harness": harness,
        "log": log[-40:],
        "computed_at": now,
    }, on_conflict="run_id").execute()

    existing_syms = {p["symbol"] for p in book_rows}
    new_syms = {p["symbol"] for p in surviving_list}
    for sym in existing_syms - new_syms:
        sb.table("paper_book_xs").delete().eq("symbol", sym).execute()
    if surviving_list:
        sb.table("paper_book_xs").upsert(surviving_list, on_conflict="symbol").execute()
    if orders:
        sb.table("paper_orders_xs").upsert(orders, on_conflict="id").execute()

    note("INFO", f"Loop XS complete · {headline}")
    run.set_row_counts(names=len(surviving_list), orders=len(orders))


def _sector_exposure(book: list[dict], equity: float) -> list[dict]:
    from collections import defaultdict

    sector_count = defaultdict(int)
    for p in book:
        sector_count[p.get("sector") or "Unknown"] += 1
    out = []
    for sector, cnt in sorted(sector_count.items()):
        mv = sum(
            (p["last"] or 0) * p["shares"]
            for p in book
            if (p.get("sector") or "Unknown") == sector
        )
        out.append({
            "sector": sector,
            "exposurePct": round(mv / equity, 4) if equity else 0,
            "names": cnt,
        })
    return out


def _hold_trail_stop(frame: pd.DataFrame | None, entry: float, opened: date | None) -> float:
    if frame is None or frame.empty or entry <= 0:
        return 0.0
    view = frame
    if opened is not None and "date" in view.columns:
        dates = pd.to_datetime(view["date"], errors="coerce")
        view = view.loc[dates >= pd.Timestamp(opened)]
    if view.empty or "close" not in view.columns:
        return 0.0
    close = pd.to_numeric(view["close"], errors="coerce")
    high = pd.to_numeric(view["high"], errors="coerce") if "high" in view.columns else close
    sma = close.rolling(20, min_periods=20).mean()
    return replay_wide_stop(entry, high.tolist(), close.tolist(), sma.tolist())


def _book_row(
    sym: str,
    u: dict,
    pos: dict,
    shares: int,
    entry: float,
    last: float,
    run_id: str,
    now: str,
    today: date,
    opened: date,
    reason: str = "",
    rank: int | None = None,
    rs_pct: float | None = None,
    stop: float | None = None,
) -> dict:
    opened_s = opened.isoformat() if isinstance(opened, date) else str(opened)[:10]
    days_held = (today - (_parse_date(opened_s) or today)).days
    stored_stop = None if stop is None or stop <= 0 else round(float(stop), 2)
    stored_rs = None if rs_pct is None else round(float(rs_pct), 2)
    return {
        "symbol": sym,
        "run_id": run_id,
        "company_name": u.get("company_name") or pos.get("company_name"),
        "side": "LONG",
        "shares": shares,
        "entry": round(entry, 2),
        "last": round(last, 2),
        "stop": stored_stop,
        "n": stored_rs,
        "risk_usd": None,
        "sector": u.get("sector") or pos.get("sector") or "",
        "reason": reason or pos.get("reason") or "",
        "rank": rank if rank is not None else pos.get("rank"),
        "breakout": pos.get("breakout"),
        "green": True,
        "unrealized_pnl_usd": round((last - entry) * shares, 2),
        "days_held": days_held,
        "opened_at": opened_s,
        "updated_at": now,
    }


if __name__ == "__main__":
    main()
