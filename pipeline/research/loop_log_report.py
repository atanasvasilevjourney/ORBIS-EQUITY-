"""Load LOOP (Trend Radar paper harness) runs, orders, and logs from Supabase."""
from __future__ import annotations

import os
import re
from collections import defaultdict
from datetime import date
from typing import Any

import pandas as pd
from supabase import Client, create_client

from pipeline.utils.supabase import fetch_all

EQUITY_START = 100_000.0


def get_client() -> Client:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
    return create_client(url, key)


def load_loop_tables(sb: Client | None = None) -> dict[str, list[dict]]:
    sb = sb or get_client()
    return {
        "runs": fetch_all(
            sb,
            "paper_loop_runs",
            "run_id, asof_date, equity, deployed_pct, open_risk_pct, names, posture, status, headline, harness, log, computed_at",
            order=("asof_date", False),
        ),
        "orders": fetch_all(
            sb,
            "paper_orders",
            "id, run_id, ticker, action, type, shares, limit_price, reason, sector, risk_usd, created_at",
            order=("created_at", False),
        ),
        "book": fetch_all(sb, "paper_book", "*"),
    }


def parse_exit_price(order: dict) -> float | None:
    if order.get("limit_price") is not None:
        return float(order["limit_price"])
    reason = order.get("reason") or ""
    m = re.search(r"last\s+([\d.]+)", reason)
    return float(m.group(1)) if m else None


def flatten_run_logs(runs: list[dict]) -> pd.DataFrame:
    rows: list[dict] = []
    for run in runs:
        for entry in run.get("log") or []:
            rows.append(
                {
                    "run_id": run["run_id"],
                    "asof_date": run.get("asof_date"),
                    "at": entry.get("at"),
                    "level": entry.get("level"),
                    "message": entry.get("message"),
                }
            )
    return pd.DataFrame(rows)


def closed_trades(orders: list[dict]) -> pd.DataFrame:
    lots: dict[str, list[dict]] = defaultdict(list)
    closed: list[dict] = []
    for o in sorted(orders, key=lambda x: x["created_at"]):
        ticker = o["ticker"]
        shares = int(o["shares"])
        if o["action"] == "BUY":
            lots[ticker].append(
                {
                    "shares": shares,
                    "entry": float(o["limit_price"]),
                    "entry_reason": o.get("reason"),
                    "entered_at": o["created_at"],
                }
            )
            continue
        exit_px = parse_exit_price(o)
        if exit_px is None:
            continue
        remaining = shares
        while remaining > 0 and lots[ticker]:
            lot = lots[ticker][0]
            take = min(remaining, lot["shares"])
            pnl = (exit_px - lot["entry"]) * take
            closed.append(
                {
                    "ticker": ticker,
                    "shares": take,
                    "entry": lot["entry"],
                    "exit": exit_px,
                    "pnl_usd": pnl,
                    "return_pct": (exit_px / lot["entry"] - 1) * 100,
                    "entry_reason": lot["entry_reason"],
                    "exit_reason": o.get("reason"),
                    "entered_at": lot["entered_at"],
                    "exited_at": o["created_at"],
                }
            )
            lot["shares"] -= take
            remaining -= take
            if lot["shares"] == 0:
                lots[ticker].pop(0)
    return pd.DataFrame(closed)


def portfolio_snapshot(orders: list[dict], book: list[dict]) -> dict[str, Any]:
    closed = closed_trades(orders)
    realized = float(closed["pnl_usd"].sum()) if len(closed) else 0.0
    unrealized = float(sum((p.get("unrealized_pnl_usd") or 0) for p in book))
    deployed = float(sum((p.get("last") or 0) * p["shares"] for p in book))
    cash = EQUITY_START
    for o in sorted(orders, key=lambda x: x["created_at"]):
        if o["action"] == "BUY":
            cash -= int(o["shares"]) * float(o["limit_price"])
        else:
            px = parse_exit_price(o)
            if px is not None:
                cash += int(o["shares"]) * px
    mtm_equity = cash + deployed
    total_pnl = mtm_equity - EQUITY_START
    return {
        "start_equity_usd": EQUITY_START,
        "mtm_equity_usd": mtm_equity,
        "total_pnl_usd": total_pnl,
        "total_return_pct": total_pnl / EQUITY_START * 100,
        "realized_pnl_usd": realized,
        "unrealized_pnl_usd": unrealized,
        "deployed_notional_usd": deployed,
        "deployed_pct": deployed / EQUITY_START * 100,
        "open_names": len(book),
        "closed_trades": len(closed),
        "win_rate_pct": (closed["pnl_usd"] > 0).mean() * 100 if len(closed) else None,
    }


def equity_curve_from_prices(
    sb: Client,
    orders: list[dict],
    *,
    end: date | None = None,
) -> pd.DataFrame:
    """Replay cash + positions; mark open lots with daily closes from prices_daily."""
    tickers = sorted({o["ticker"] for o in orders})
    price_rows = fetch_all(
        sb,
        "prices_daily",
        "symbol, date, close",
        filters=lambda q: q.in_("symbol", tickers),
        order=("date", False),
    )
    prices = pd.DataFrame(price_rows)
    if prices.empty:
        return pd.DataFrame()
    prices["date"] = pd.to_datetime(prices["date"]).dt.date
    prices = prices.sort_values(["symbol", "date"])

    def close_on(d: date, symbol: str) -> float | None:
        sub = prices[(prices["symbol"] == symbol) & (prices["date"] <= d)]
        if sub.empty:
            return None
        return float(sub.iloc[-1]["close"])

    events = sorted(orders, key=lambda x: x["created_at"])
    if not events:
        return pd.DataFrame()

    start_d = pd.to_datetime(events[0]["created_at"]).date()
    end_d = end or pd.to_datetime(events[-1]["created_at"]).date()
    all_dates = sorted(set(prices["date"].tolist()))
    timeline = [d for d in all_dates if start_d <= d <= end_d]
    if not timeline:
        timeline = [start_d, end_d]

    cash = EQUITY_START
    positions: dict[str, list[dict]] = defaultdict(list)
    event_idx = 0
    points: list[dict] = []

    for d in timeline:
        while event_idx < len(events) and pd.to_datetime(events[event_idx]["created_at"]).date() <= d:
            o = events[event_idx]
            sym = o["ticker"]
            sh = int(o["shares"])
            if o["action"] == "BUY":
                cash -= sh * float(o["limit_price"])
                positions[sym].append({"shares": sh, "entry": float(o["limit_price"])})
            else:
                px = parse_exit_price(o)
                if px is not None:
                    cash += sh * px
                    remaining = sh
                    while remaining > 0 and positions[sym]:
                        lot = positions[sym][0]
                        take = min(remaining, lot["shares"])
                        lot["shares"] -= take
                        remaining -= take
                        if lot["shares"] == 0:
                            positions[sym].pop(0)
            event_idx += 1

        mkt = 0.0
        for sym, lots in positions.items():
            px = close_on(d, sym)
            if px is None:
                continue
            mkt += sum(lot["shares"] * px for lot in lots)
        eq = cash + mkt
        points.append(
            {
                "date": d,
                "equity_usd": eq,
                "cash_usd": cash,
                "market_value_usd": mkt,
                "return_pct": (eq / EQUITY_START - 1) * 100,
            }
        )
    return pd.DataFrame(points)
