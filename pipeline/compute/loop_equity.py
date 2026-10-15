"""Replay LOOP paper orders + open book for mark-to-market equity."""
from __future__ import annotations

import re
from typing import Any

from pipeline.compute.donchian_vwap import EQUITY as EQUITY_START


def parse_exit_price(order: dict) -> float | None:
    if order.get("limit_price") is not None:
        return float(order["limit_price"])
    reason = order.get("reason") or ""
    m = re.search(r"last\s+([\d.]+)", reason)
    return float(m.group(1)) if m else None


def loop_portfolio_equity(
    orders: list[dict],
    book: list[dict],
    *,
    start_equity: float = EQUITY_START,
) -> dict[str, Any]:
    """Cash replay from all fills + open positions at `last` (or entry)."""
    deployed = 0.0
    for p in book:
        sh = int(p.get("shares") or 0)
        last = float(p.get("last") or p.get("entry") or 0)
        deployed += sh * last

    cash = float(start_equity)
    for o in sorted(orders, key=lambda x: str(x.get("created_at") or "")):
        action = (o.get("action") or "").upper()
        shares = int(o.get("shares") or 0)
        if shares <= 0:
            continue
        if action == "BUY":
            lp = o.get("limit_price")
            if lp is not None:
                cash -= shares * float(lp)
        elif action == "SELL":
            px = parse_exit_price(o)
            if px is not None:
                cash += shares * px

    mtm_equity = cash + deployed
    total_pnl = mtm_equity - start_equity
    denom = mtm_equity if mtm_equity > 0 else start_equity
    realized = loop_realized_pnl(orders)
    unrealized = round(total_pnl - realized, 2)
    return {
        "start_equity_usd": start_equity,
        "cash_usd": round(cash, 2),
        "deployed_notional_usd": round(deployed, 2),
        "mtm_equity_usd": round(mtm_equity, 2),
        "total_pnl_usd": round(total_pnl, 2),
        "realized_pnl_usd": realized,
        "unrealized_pnl_usd": unrealized,
        "deployed_pct": round(deployed / denom, 4) if denom else 0.0,
    }


def loop_realized_pnl(orders: list[dict]) -> float:
    """FIFO realized P&L from closed lots (diagnostic)."""
    from collections import defaultdict

    lots: dict[str, list[dict]] = defaultdict(list)
    realized = 0.0
    for o in sorted(orders, key=lambda x: str(x.get("created_at") or "")):
        ticker = o["ticker"]
        shares = int(o["shares"])
        if (o.get("action") or "").upper() == "BUY":
            lp = o.get("limit_price")
            if lp is None:
                continue
            lots[ticker].append({"shares": shares, "entry": float(lp)})
            continue
        exit_px = parse_exit_price(o)
        if exit_px is None:
            continue
        remaining = shares
        while remaining > 0 and lots[ticker]:
            lot = lots[ticker][0]
            take = min(remaining, lot["shares"])
            realized += (exit_px - lot["entry"]) * take
            lot["shares"] -= take
            remaining -= take
            if lot["shares"] == 0:
                lots[ticker].pop(0)
    return round(realized, 2)
