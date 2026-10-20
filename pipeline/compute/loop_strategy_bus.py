"""Read donchian_vwap candidates from strategy_signals for portfolio_loop."""
from __future__ import annotations

from datetime import date

from pipeline.utils.supabase import fetch_all

STRATEGY_DONCHIAN = "donchian_vwap"


def latest_signal_as_of(sb, strategy_id: str, through: date) -> date | None:
    resp = (
        sb.table("strategy_signals")
        .select("as_of")
        .eq("strategy_id", strategy_id)
        .lte("as_of", through.isoformat())
        .order("as_of", desc=True)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row or not row.get("as_of"):
        return None
    try:
        return date.fromisoformat(str(row["as_of"])[:10])
    except ValueError:
        return None


def donchian_buy_scores(sb, as_of: date) -> dict[str, float]:
    rows = fetch_all(
        sb,
        "strategy_signals",
        "symbol, score",
        filters=lambda q: q.eq("strategy_id", STRATEGY_DONCHIAN)
        .eq("side", "BUY")
        .eq("as_of", as_of.isoformat()),
    )
    return {r["symbol"]: float(r.get("score") or 0.0) for r in rows if r.get("symbol")}
