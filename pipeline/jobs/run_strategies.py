"""Run one strategy and append rows to strategy_signals."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
from datetime import date, datetime, timezone

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

from pipeline.strategies.registry import get, list_strategies
from pipeline.universe_filters import is_loop_tradable

load_dotenv()
logger = logging.getLogger(__name__)


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _params_hash(params: dict) -> str:
    blob = json.dumps(params, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _load_bars(sb, symbols: list[str], lookback_days: int = 120) -> dict[str, pd.DataFrame]:
    from pipeline.utils.supabase import fetch_all

    rows = fetch_all(
        sb,
        "prices_daily",
        "symbol, date, open, high, low, close, volume",
        filters=lambda q: q.in_("symbol", symbols),
        order=("date", False),
    )
    by_sym: dict[str, list[dict]] = {}
    for r in rows:
        by_sym.setdefault(r["symbol"], []).append(r)
    out: dict[str, pd.DataFrame] = {}
    for sym, part in by_sym.items():
        df = pd.DataFrame(part).sort_values("date").tail(lookback_days)
        if df.empty:
            continue
        out[sym] = df
    return out


def run(strategy_id: str, as_of: date, params: dict) -> int:
    sb = _sb()
    fn = get(strategy_id)
    members = (
        sb.table("universe_members")
        .select("symbol, tier, sector, is_active")
        .eq("is_active", True)
        .execute()
    ).data or []
    universe = [m["symbol"] for m in members if is_loop_tradable(m)]
    bars = _load_bars(sb, universe)
    universe = [s for s in universe if s in bars]
    signals = fn(universe, bars, as_of, params)
    known_on = as_of
    ph = _params_hash(params)
    now = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "strategy_id": strategy_id,
            "symbol": s.symbol,
            "as_of": as_of.isoformat(),
            "known_on": known_on.isoformat(),
            "side": s.side,
            "score": s.score,
            "stop": s.stop,
            "size_hint": s.size_hint,
            "reason": s.reason,
            "params_hash": ph,
            "created_at": now,
        }
        for s in signals
    ]
    if not payload:
        logger.warning("No signals for %s on %s", strategy_id, as_of)
        return 0
    sb.table("strategy_signals").upsert(
        payload, on_conflict="strategy_id,symbol,as_of,known_on"
    ).execute()
    logger.info("Wrote %d strategy_signals rows for %s as_of=%s", len(payload), strategy_id, as_of)
    return len(payload)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("--strategy", default="donchian_vwap", choices=list_strategies())
    p.add_argument("--as-of", default=None, help="YYYY-MM-DD (default: latest prices_daily)")
    args = p.parse_args()
    as_of = date.fromisoformat(args.as_of) if args.as_of else date.today()
    run(args.strategy, as_of, {})


if __name__ == "__main__":
    main()
