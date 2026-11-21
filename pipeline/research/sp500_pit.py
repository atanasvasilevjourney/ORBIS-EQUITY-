"""Point-in-time S&P 500 membership (free historical source).

Source: `fja05680/sp500` on GitHub — daily constituent lists from 1996 onward.
On first use, the CSV is downloaded to ``pipeline/research/data/sp500_historical_components.csv``.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date
from functools import lru_cache
from pathlib import Path
from urllib.request import urlretrieve

import pandas as pd

logger = logging.getLogger(__name__)

DEFAULT_URL = (
    "https://raw.githubusercontent.com/fja05680/sp500/master/"
    "S%26P%20500%20Historical%20Components%20%26%20Changes.csv"
)
DEFAULT_PATH = Path(__file__).resolve().parent / "data" / "sp500_historical_components.csv"


def _parse_ticker_token(token: str) -> str:
    """``AAMRQ-201312`` → ``AAMRQ``; ``BRK.B`` kept as-is before any ``-`` suffix."""
    token = str(token).strip().upper()
    if not token:
        return ""
    if "-" in token:
        return token.split("-", 1)[0].strip()
    return token


def ensure_membership_csv(path: Path = DEFAULT_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.stat().st_size > 10_000:
        return path
    logger.info("Downloading S&P 500 historical constituents → %s", path)
    urlretrieve(DEFAULT_URL, path)
    return path


def load_membership_table(path: Path | None = None) -> pd.DataFrame:
    """Return DataFrame indexed by date with column ``symbols`` (set of str)."""
    csv_path = ensure_membership_csv(path or DEFAULT_PATH)
    raw = pd.read_csv(csv_path)
    raw["date"] = pd.to_datetime(raw["date"]).dt.date
    rows: list[dict] = []
    for _, r in raw.iterrows():
        toks = [t for t in str(r["tickers"]).split(",") if t.strip()]
        syms = {_parse_ticker_token(t) for t in toks}
        syms.discard("")
        rows.append({"date": r["date"], "symbols": syms})
    df = pd.DataFrame(rows).sort_values("date").drop_duplicates("date", keep="last")
    df = df.set_index("date")
    return df


@lru_cache(maxsize=1)
def _cached_table(path_str: str) -> pd.DataFrame:
    return load_membership_table(Path(path_str))


def symbols_as_of(
    as_of: date,
    *,
    path: Path | None = None,
) -> set[str]:
    table = _cached_table(str(path or DEFAULT_PATH))
    idx = table.index
    hits = [d for d in idx if d <= as_of]
    if not hits:
        return set()
    d = max(hits)
    return set(table.loc[d, "symbols"])


def membership_lookup(
    path: Path | None = None,
) -> Callable[[date], set[str]]:
    return lambda d: symbols_as_of(d, path=path)


def union_symbols_between(
    start: date,
    end: date,
    *,
    path: Path | None = None,
) -> set[str]:
    table = _cached_table(str(path or DEFAULT_PATH))
    out: set[str] = set()
    for d, row in table.iterrows():
        if start <= d <= end:
            out |= row["symbols"]
    if not out:
        for d, row in table.iterrows():
            if d <= end:
                out |= row["symbols"]
    return out


def build_sp500_sym_sector(symbols: set[str]) -> dict[str, str]:
    """Sector map: optional live scrape; defaults to Unknown (avoids network during PIT builds)."""
    from pipeline.universe_filters import is_loop_tradable, is_pharma_stock

    sectors: dict[str, str] = {}
    try:
        from pipeline.ingest.us_index_universe import build_merged_universe

        live, _ = build_merged_universe()
        sectors = {s["symbol"]: s.get("sector") or "Unknown" for s in live}
    except Exception:
        logger.warning("Live sector scrape unavailable — PIT symbols use Unknown sector")
    out: dict[str, str] = {}
    for sym in sorted(symbols):
        sec = sectors.get(sym, "Unknown")
        row = {
            "symbol": sym,
            "sector": sec,
            "industry": "",
            "is_active": True,
            "tier": "us_large",
        }
        if is_loop_tradable(row) and not is_pharma_stock(row):
            out[sym] = sec
    return out


def long_membership_csv(out_path: Path, *, path: Path | None = None) -> int:
    """Export long format ``asof_date,symbol`` (for docs / external tools)."""
    table = load_membership_table(path)
    rows: list[dict] = []
    for d, row in table.iterrows():
        for sym in sorted(row["symbols"]):
            rows.append({"asof_date": d.isoformat(), "symbol": sym})
    df = pd.DataFrame(rows)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)
    return len(df)