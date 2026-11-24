"""Trend-band scan universe: ema200_universe + ETFs/index/crypto supplements."""
from __future__ import annotations

from pipeline.trend_band_scanner.config.loader import load_config
from pipeline.utils.supabase import fetch_all


def _classify(sym: str, meta: dict | None) -> str:
    if meta and meta.get("asset_class") == "crypto":
        return "crypto"
    if sym.startswith("^"):
        return "index"
    if meta and meta.get("is_etf"):
        return "etf"
    etf_like = {"USO", "XLE", "XLV", "XLF", "DBC", "GLD", "SPY", "QQQ", "IWM", "MDY", "RSP", "TLT"}
    if sym in etf_like or sym.endswith("-USD"):
        return "etf" if not sym.endswith("-USD") else "crypto"
    return str(meta.get("asset_class") if meta else "equity") or "equity"


def load_scan_universe(sb) -> list[dict]:
    cfg = load_config()
    uni_cfg = cfg.get("universe") or {}
    meta_by_sym: dict[str, dict] = {}

    if uni_cfg.get("use_ema200_universe", True):
        try:
            for row in fetch_all(sb, "ema200_universe", "symbol, asset_class, is_etf, index_tag, active", lambda q: q.eq("active", True)):
                sym = str(row.get("symbol") or "").upper()
                if sym:
                    meta_by_sym[sym] = row
        except Exception:
            pass

    if not meta_by_sym:
        from pipeline.ingest.us_index_universe import build_merged_universe

        for s in build_merged_universe()[0]:
            sym = str(s.get("symbol") or "").upper()
            if sym:
                meta_by_sym[sym] = {"asset_class": "equity", "is_etf": False, "index_tag": s.get("tier")}

    for sym in [str(s).upper() for s in uni_cfg.get("supplements") or [] if s]:
        meta_by_sym.setdefault(sym, {"asset_class": "etf", "is_etf": True})

    for sym in [str(s).upper() for s in uni_cfg.get("indices") or [] if s]:
        meta_by_sym.setdefault(sym, {"asset_class": "index", "is_etf": False})

    if uni_cfg.get("include_crypto", True):
        for sym in [str(s).upper() for s in uni_cfg.get("crypto") or [] if s]:
            meta_by_sym.setdefault(sym, {"asset_class": "crypto", "is_etf": False})

    rows: list[dict] = []
    for sym, meta in sorted(meta_by_sym.items()):
        rows.append({"symbol": sym, "asset_class": _classify(sym, meta), "index_tag": meta.get("index_tag")})
    return rows