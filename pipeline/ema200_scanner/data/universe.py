"""Build and refresh ``ema200_universe`` (S&P 500 + Nasdaq-100 by default)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from supabase import Client

from pipeline.ema200_scanner.config.loader import load_config
from pipeline.ema200_scanner.data.crypto import top_crypto_pairs
from pipeline.ema200_scanner.data.us_indices import sp500_nasdaq100_stocks
from pipeline.utils.supabase import fetch_all

logger = logging.getLogger(__name__)


def _index_tag(tier: str) -> str:
    if tier == "us_large":
        return "sp500"
    if tier == "us_nasdaq100":
        return "ndx100"
    return "us"


def sync_ema200_universe(sb: Client) -> list[dict]:
    """Upsert scanner universe and deactivate symbols outside the configured set."""
    cfg = load_config()
    uni_cfg = cfg.get("universe", {})
    mode = str(uni_cfg.get("equities", "sp500_ndx100"))
    include_crypto = bool(uni_cfg.get("include_crypto", False))
    exclude_pharma = bool(uni_cfg.get("exclude_pharma", False))

    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []
    allowed: set[str] = set()

    if mode == "sp500_ndx100":
        stocks, stats = sp500_nasdaq100_stocks(exclude_pharma=exclude_pharma)
        logger.info(
            "EMA200 universe sp500_ndx100: merged=%d sp500=%d ndx=%d",
            stats.get("merged"),
            stats.get("sp500"),
            stats.get("nasdaq100"),
        )
        for s in stocks:
            sym = s["symbol"]
            allowed.add(sym)
            rows.append(
                {
                    "symbol": sym,
                    "asset_class": "equity",
                    "exchange": s.get("exchange"),
                    "index_tag": _index_tag(s.get("tier", "")),
                    "is_etf": False,
                    "active": True,
                    "updated_at": now,
                }
            )
    elif mode == "all_us":
        members = fetch_all(
            sb,
            "universe_members",
            "symbol, exchange, country, is_active",
            filters=lambda q: q.eq("is_active", True),
        )
        for m in members:
            if (m.get("country") or "").upper() != "US":
                continue
            sym = m.get("symbol")
            if not sym:
                continue
            allowed.add(sym)
            rows.append(
                {
                    "symbol": sym,
                    "asset_class": "equity",
                    "exchange": m.get("exchange"),
                    "index_tag": "us",
                    "is_etf": False,
                    "active": True,
                    "updated_at": now,
                }
            )
    else:
        raise ValueError(f"Unknown universe.equities mode: {mode}")

    if include_crypto:
        crypto_n = int(cfg.get("crypto", {}).get("top_n", 50))
        for pair in top_crypto_pairs(top_n=crypto_n):
            sym = pair.replace("/", "-")
            allowed.add(sym)
            rows.append(
                {
                    "symbol": sym,
                    "asset_class": "crypto",
                    "exchange": "binance",
                    "index_tag": "crypto",
                    "is_etf": False,
                    "active": True,
                    "updated_at": now,
                }
            )

    if not rows:
        logger.warning("ema200 universe sync produced zero rows")
        return []

    batch_size = 500
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        sb.table("ema200_universe").upsert(batch, on_conflict="symbol").execute()

    # Deactivate equities/crypto no longer in the merged index set
    existing = fetch_all(sb, "ema200_universe", "symbol")
    stale = [r["symbol"] for r in existing if r.get("symbol") not in allowed]
    for i in range(0, len(stale), batch_size):
        sb.table("ema200_universe").update({"active": False, "updated_at": now}).in_(
            "symbol", stale[i : i + batch_size]
        ).execute()

    logger.info("Synced ema200_universe: %d active symbols (%d deactivated)", len(rows), len(stale))
    return rows


def main() -> None:
    """Sync index universe only (no feature compute)."""
    import os

    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv()
    logging.basicConfig(level=logging.INFO)
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    sync_ema200_universe(create_client(url, key))


if __name__ == "__main__":
    main()
