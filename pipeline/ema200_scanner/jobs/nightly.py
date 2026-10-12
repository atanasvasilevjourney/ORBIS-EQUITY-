"""Nightly EMA200 features job — universe sync, indicators, Supabase upsert.

Usage:
    PYTHONPATH=/workspace python -m pipeline.ema200_scanner.jobs.nightly
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timezone

import pandas as pd
from dotenv import load_dotenv
from supabase import Client, create_client

from pipeline.config.settings import SupabaseConfig
from pipeline.ema200_scanner.config.loader import config_hash, load_config
from pipeline.ema200_scanner.data.corp_actions import flag_phantom_split_moves
from pipeline.ema200_scanner.data.crypto import fetch_crypto_ohlcv
from pipeline.ema200_scanner.data.universe import sync_ema200_universe
from pipeline.ema200_scanner.data.vendors.supabase_prices import load_prices_dataframe
from pipeline.ema200_scanner.data.vendors.yahoo import YahooCashEodVendor
from pipeline.ema200_scanner.indicators.features import compute_features_frame, compute_regime
from pipeline.utils.supabase import fetch_all

load_dotenv()
logger = logging.getLogger(__name__)


def _sb() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(cfg.url, cfg.service_key)


def _load_benchmark_series(
    sb: Client,
    symbol: str,
    *,
    asset_class: str,
    min_bars: int,
    vendor: YahooCashEodVendor,
) -> pd.Series:
    """Benchmark close series for regime tagging."""
    if asset_class == "crypto" and "/" in symbol:
        df = fetch_crypto_ohlcv(symbol, limit=min_bars)
    else:
        df = load_prices_dataframe(sb, symbol)
        if len(df) < min_bars:
            hist = vendor.fetch_history(symbol, min_bars=min_bars, country="US")
            if hist:
                df = _vendor_bars_to_frame(hist)
    if df.empty:
        return pd.Series(dtype=float)
    return df["close"].astype(float)


def _vendor_bars_to_frame(bars) -> pd.DataFrame:
    rows = []
    for b in bars:
        rows.append(
            {
                "date": b.date,
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume or 0,
            }
        )
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").set_index("date")
    return df


def _features_to_rows(symbol: str, feat: pd.DataFrame) -> list[dict]:
    out: list[dict] = []
    for idx, row in feat.iterrows():
        if pd.isna(row.get("ema200")):
            continue
        bar_date = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
        out.append(
            {
                "symbol": symbol,
                "bar_date": bar_date,
                "close": _num(row.get("close")),
                "ema200": _num(row.get("ema200")),
                "ema200_slope": _num(row.get("ema200_slope")),
                "atr14": _num(row.get("atr14")),
                "dist_atr": _num(row.get("dist_atr")),
                "rvol": _num(row.get("rvol")),
                "days_above": int(row.get("days_above") or 0),
                "regime": row.get("regime"),
            }
        )
    return out


def _num(v) -> float | None:
    if v is None or (isinstance(v, float) and not pd.notna(v)):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def run_nightly(*, sb: Client | None = None) -> dict:
    """Compute features for ema200 universe and upsert ``ema200_features``."""
    t0 = time.monotonic()
    cfg = load_config()
    sb = sb or _sb()
    vendor = YahooCashEodVendor()

    ema_period = int(cfg["ema_period"])
    atr_period = int(cfg["atr_period"])
    history_min = int(cfg["history_min_bars"])
    slope_lb = int(cfg["trend"]["slope_lookback"])
    min_bars = int(cfg.get("nightly", {}).get("min_history_bars", history_min + 50))
    max_backfill = int(cfg.get("nightly", {}).get("max_vendor_backfill_symbols", 200))
    abort_pct = float(cfg.get("nightly", {}).get("missing_data_abort_pct", 15.0))
    budget = float(cfg.get("nightly", {}).get("time_budget_sec", 3600))

    sync_ema200_universe(sb)
    universe = fetch_all(sb, "ema200_universe", "symbol, asset_class, active", filters=lambda q: q.eq("active", True))

    eq_bm = cfg["regime"]["equity_benchmark"]
    cr_bm = cfg["regime"]["crypto_benchmark"]
    spy_close = _load_benchmark_series(sb, eq_bm, asset_class="equity", min_bars=min_bars, vendor=vendor)
    btc_close = _load_benchmark_series(sb, cr_bm.replace("-", "/"), asset_class="crypto", min_bars=min_bars, vendor=vendor)

    spy_regime = (
        compute_regime(spy_close, ema_period, history_min)
        if not spy_close.empty
        else pd.Series(dtype=object)
    )
    btc_regime = (
        compute_regime(btc_close, ema_period, history_min)
        if not btc_close.empty
        else pd.Series(dtype=object)
    )

    all_rows: list[dict] = []
    missing = 0
    backfill_count = 0
    split_flags: dict[str, list[str]] = {}

    for entry in universe:
        if time.monotonic() - t0 > budget:
            logger.error("Nightly time budget exceeded (%.0fs)", budget)
            break

        symbol = entry["symbol"]
        asset_class = entry.get("asset_class") or "equity"

        try:
            if asset_class == "crypto":
                pair = symbol.replace("-", "/")
                ohlcv = fetch_crypto_ohlcv(pair, limit=min_bars)
                regime_lookup = btc_regime
            else:
                ohlcv = load_prices_dataframe(sb, symbol)
                if len(ohlcv) < min_bars and backfill_count < max_backfill:
                    hist = vendor.fetch_history(symbol, min_bars=min_bars, country="US")
                    backfill_count += 1
                    if hist:
                        ohlcv = _vendor_bars_to_frame(hist)
                regime_lookup = spy_regime

            if ohlcv.empty or len(ohlcv) < history_min:
                missing += 1
                continue

            phantom = flag_phantom_split_moves(ohlcv)
            if phantom:
                split_flags[symbol] = phantom[-3:]

            regime_val = None
            if not regime_lookup.empty:
                last_idx = ohlcv.index[-1]
                if last_idx in regime_lookup.index:
                    regime_val = regime_lookup.loc[last_idx]
                else:
                    regime_val = regime_lookup.iloc[-1]

            feat = compute_features_frame(
                ohlcv,
                ema_period=ema_period,
                atr_period=atr_period,
                history_min_bars=history_min,
                slope_lookback=slope_lb,
                regime=str(regime_val) if regime_val is not None else None,
            )
            # Only upsert the latest bar nightly (full history stays in research path)
            latest = feat.tail(1)
            all_rows.extend(_features_to_rows(symbol, latest))
        except Exception:
            logger.warning("Feature compute failed for %s", symbol, exc_info=True)
            missing += 1

    total = len(universe) or 1
    miss_pct = 100.0 * missing / total
    if miss_pct > abort_pct:
        logger.error(
            "Aborting upsert: %.1f%% symbols missing data (threshold %.1f%%)",
            miss_pct,
            abort_pct,
        )
        raise RuntimeError(f"ema200 nightly missing data {miss_pct:.1f}%")

    upserted = 0
    batch_size = 500
    for i in range(0, len(all_rows), batch_size):
        batch = all_rows[i : i + batch_size]
        sb.table("ema200_features").upsert(batch, on_conflict="symbol,bar_date").execute()
        upserted += len(batch)

    run_id = str(uuid.uuid4())
    finished = datetime.now(timezone.utc)
    headline = f"ema200 nightly upserted={upserted} missing={missing} backfill={backfill_count}"
    try:
        sb.table("ingest_runs").upsert(
            {
                "run_id": run_id,
                "module": "ema200_scanner.nightly",
                "started_at": finished.isoformat(),
                "finished_at": finished.isoformat(),
                "symbols_ok": len(universe) - missing,
                "symbols_fail": missing,
                "rows_upserted": upserted,
                "source": "prices_daily+yahoo",
                "headline": headline,
                "config": {"hash": config_hash(cfg), "split_flags": split_flags},
            },
            on_conflict="run_id",
        ).execute()
    except Exception:
        logger.debug("ingest_runs log skipped", exc_info=True)

    elapsed = time.monotonic() - t0
    logger.info("=== EMA200 nightly complete in %.1fs: %s ===", elapsed, headline)
    return {
        "upserted": upserted,
        "missing": missing,
        "elapsed_sec": elapsed,
        "config_hash": config_hash(cfg),
    }


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    if os.getenv("EMA200_DRY_RUN") == "1":
        logger.info("EMA200_DRY_RUN=1 — skipping Supabase writes")
        return
    run_nightly()


if __name__ == "__main__":
    main()
