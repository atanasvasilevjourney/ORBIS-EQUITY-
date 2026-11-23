"""Point-in-time Nasdaq-100 membership from public Wikipedia change tables.

Source: https://en.wikipedia.org/wiki/Nasdaq-100 (historical component changes).
Cached events: ``pipeline/research/data/nasdaq100_pit_events.csv`` (generated on first use).

Gaps: pre-2008 changes are sparse on Wikipedia; before the first parsed event we seed from
the earliest known full list (2008-12-22 snapshot). Names added before our seed may show
survivorship until the first change row affects them.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Callable
from datetime import date
from functools import lru_cache
from io import StringIO
from pathlib import Path
from urllib.request import Request, urlopen

import pandas as pd

from pipeline.research.sp500_pit import _parse_ticker_token

logger = logging.getLogger(__name__)

WIKI_URL = "https://en.wikipedia.org/wiki/Nasdaq-100"
DEFAULT_EVENTS_PATH = Path(__file__).resolve().parent / "data" / "nasdaq100_pit_events.csv"
# Earliest full-lineup anchor when Wikipedia change log starts mid-history
SEED_DATE = date(2008, 12, 22)
SEED_SYMBOLS = (
    "AAPL", "ADBE", "ADP", "ADSK", "AKAM", "ALTR", "AMAT", "AMGN", "AMZN", "APOL",
    "ATVI", "BIDU", "BIIB", "BMY", "CELG", "CMCSA", "COST", "CSCO", "DELL", "DISCA",
    "EBAY", "ERTS", "EXPE", "FAST", "FISV", "GILD", "GOOG", "GRMN", "HSIC", "INFY",
    "INTC", "INTU", "ISRG", "JAVA", "JOYG", "KLAC", "LRCX", "MAT", "MCHP", "MICC",
    "MSFT", "MU", "MXIM", "MYL", "NFLX", "NIHD", "NTAP", "NVDA", "ORCL", "PAYX",
    "PCAR", "PCLN", "QCOM", "ROST", "SBUX", "SHLD", "SIAL", "SIRI", "SNDK", "SPLS",
    "SYMC", "TEVA", "TXN", "VMED", "VRSN", "VRTX", "WYNN", "XLNX", "XMSR", "YHOO",
)


def _fetch_wiki_html() -> str:
    req = Request(WIKI_URL, headers={"User-Agent": "OrbisEquity-Research/1.0"})
    with urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _parse_wiki_changes(html: str) -> list[dict]:
    """Parse Year | Companies added | Companies removed tables."""
    tables = pd.read_html(StringIO(html))
    events: list[dict] = []
    date_re = re.compile(r"(\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2},\s+\d{4})")
    for df in tables:
        cols = [str(c).lower() for c in df.columns]
        if not any("added" in c for c in cols) or not any("removed" in c for c in cols):
            continue
        added_col = next(df.columns[i] for i, c in enumerate(cols) if "added" in c)
        removed_col = next(df.columns[i] for i, c in enumerate(cols) if "removed" in c)
        date_col = df.columns[0]
        for _, row in df.iterrows():
            raw_date = str(row.get(date_col, "")).strip()
            if not raw_date or raw_date.lower() in {"date", "year"}:
                continue
            parsed: date | None = None
            try:
                if re.match(r"\d{4}-\d{2}-\d{2}", raw_date):
                    parsed = date.fromisoformat(raw_date[:10])
                else:
                    parsed = pd.to_datetime(raw_date, errors="coerce")
                    if pd.notna(parsed):
                        parsed = parsed.date()
            except Exception:
                m = date_re.search(raw_date)
                if m:
                    parsed = pd.to_datetime(m.group(1), errors="coerce")
                    if pd.notna(parsed):
                        parsed = parsed.date()
            if parsed is None:
                continue
            adds = _tokenize_tickers(str(row.get(added_col, "")))
            rems = _tokenize_tickers(str(row.get(removed_col, "")))
            if not adds and not rems:
                continue
            events.append({"date": parsed, "added": adds, "removed": rems})
    events.sort(key=lambda e: e["date"])
    return events


def _tokenize_tickers(cell: str) -> list[str]:
    if not cell or cell.lower() in {"nan", "none", "-", "—"}:
        return []
    parts = re.split(r"[,;\n]+", cell)
    out: list[str] = []
    for p in parts:
        tok = _parse_ticker_token(p)
        if tok and tok not in {"ADDED", "REMOVED", "NAN"}:
            out.append(tok)
    return out


def ensure_events_csv(path: Path = DEFAULT_EVENTS_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.stat().st_size > 200:
        return path
    logger.info("Building Nasdaq-100 PIT events from Wikipedia → %s", path)
    try:
        html = _fetch_wiki_html()
        events = _parse_wiki_changes(html)
    except Exception as exc:
        logger.warning("Wikipedia scrape failed (%s) — writing seed-only events", exc)
        events = []
    rows: list[dict] = [{"date": SEED_DATE.isoformat(), "added": ",".join(SEED_SYMBOLS), "removed": ""}]
    for ev in events:
        if ev["date"] <= SEED_DATE:
            continue
        rows.append(
            {
                "date": ev["date"].isoformat(),
                "added": ",".join(ev["added"]),
                "removed": ",".join(ev["removed"]),
            }
        )
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def load_events(path: Path | None = None) -> list[dict]:
    csv_path = ensure_events_csv(path or DEFAULT_EVENTS_PATH)
    df = pd.read_csv(csv_path)
    out: list[dict] = []
    for _, r in df.iterrows():
        d = pd.to_datetime(r["date"]).date()
        adds = [t for t in str(r.get("added", "")).split(",") if t.strip()]
        rems = [t for t in str(r.get("removed", "")).split(",") if t.strip()]
        out.append({"date": d, "added": adds, "removed": rems})
    out.sort(key=lambda e: e["date"])
    return out


@lru_cache(maxsize=1)
def _membership_timeline(path_str: str) -> list[tuple[date, frozenset[str]]]:
    events = load_events(Path(path_str))
    current = set(SEED_SYMBOLS)
    timeline: list[tuple[date, frozenset[str]]] = [(SEED_DATE, frozenset(current))]
    for ev in events:
        if ev["date"] <= SEED_DATE:
            continue
        for s in ev["removed"]:
            current.discard(s)
        for s in ev["added"]:
            current.add(s)
        timeline.append((ev["date"], frozenset(current)))
    return timeline


def symbols_as_of(as_of: date, *, path: Path | None = None) -> set[str]:
    timeline = _membership_timeline(str(path or DEFAULT_EVENTS_PATH))
    out: frozenset[str] = frozenset()
    for d, syms in timeline:
        if d <= as_of:
            out = syms
        else:
            break
    return set(out)


def membership_lookup(path: Path | None = None) -> Callable[[date], set[str]]:
    return lambda d: symbols_as_of(d, path=path)