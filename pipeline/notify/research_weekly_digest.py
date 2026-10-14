"""Sunday ORBIS research + watchlist digest → email (Resend).

Uses latest research_weekly pack (macro, setups) plus top GREEN trend-radar names.
Regenerates the pack if missing or older than 6 days.

Usage:
    python -m pipeline.notify.research_weekly_digest --dry-run
    python -m pipeline.notify.research_weekly_digest

Env: SUPABASE_*, RESEND_API_KEY, ALERT_EMAIL, ALERT_EMAIL_FROM, APP_BASE_URL
"""
from __future__ import annotations

import argparse
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

from dotenv import load_dotenv

from pipeline.notify.alert_digest import DEFAULT_FROM, send_resend_email
from pipeline.research_framework.generate_weekly import (
    generate_pack,
    load_config,
    persist_pack,
)
from pipeline.utils.supabase import fetch_all

logger = logging.getLogger(__name__)

WATCHLIST_TOP_N = 12
PACK_MAX_AGE_DAYS = 6


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def load_or_refresh_pack(sb: Any) -> tuple[dict, list[dict], str | None]:
    """Return (run_row, setups, run_id). Regenerates pack if stale."""
    runs = fetch_all(
        sb,
        "research_weekly_runs",
        "run_id, week_ending, headline, macro, sectors, risk_notes, computed_at",
        order=("computed_at", False),
    )
    latest = runs[0] if runs else None
    need_refresh = True
    if latest:
        we = _parse_date(latest.get("week_ending"))
        if we and (date.today() - we).days <= PACK_MAX_AGE_DAYS:
            need_refresh = False
    if need_refresh:
        logger.info("Research pack missing or stale — regenerating")
        cfg = load_config()
        pack = generate_pack(sb, cfg)
        run_id = persist_pack(sb, pack)
        return (
            {
                "run_id": run_id,
                "week_ending": pack["week_ending"],
                "headline": pack.get("headline"),
                "macro": pack.get("macro") or {},
                "sectors": pack.get("sectors") or [],
                "risk_notes": pack.get("risk_notes") or [],
            },
            pack.get("setups") or [],
            run_id,
        )
    run_id = latest["run_id"]
    setups_raw = fetch_all(sb, "research_weekly_setups", "*")
    setups = [
        {
            "symbol": s["symbol"],
            "company_name": s.get("company_name") or "",
            "theme": s.get("theme"),
            "entry_px": s.get("entry_px"),
            "stop_px": s.get("stop_px"),
            "target_px": s.get("target_px"),
            "rr": s.get("rr"),
            "rationale": s.get("rationale"),
        }
        for s in sorted(
            [x for x in setups_raw if x.get("run_id") == run_id],
            key=lambda x: x.get("rank") or 0,
        )
    ]
    return latest, setups, run_id


def fetch_watchlist_leaders(sb: Any, *, top_n: int = WATCHLIST_TOP_N) -> list[dict]:
    radar = fetch_all(
        sb,
        "trend_radar",
        "symbol, quality_rank, convergence_count, entry_timing, breakout_active, volume_confirmed",
        filters=lambda q: q.eq("state", 1),
        order=("quality_rank", False),
    )
    radar = radar[:top_n]
    syms = {r["symbol"] for r in radar if r.get("symbol")}
    fund = {
        r["symbol"]: r
        for r in fetch_all(sb, "fundamentals_snapshot", "symbol, company_name, sector")
        if r.get("symbol") in syms
    }
    out = []
    for r in radar:
        sym = r.get("symbol") or ""
        f = fund.get(sym, {})
        out.append(
            {
                "symbol": sym,
                "company_name": f.get("company_name") or "",
                "sector": f.get("sector") or "",
                "quality_rank": r.get("quality_rank"),
                "convergence_count": r.get("convergence_count"),
                "entry_timing": r.get("entry_timing"),
            }
        )
    return out


def format_digest_text(
    *,
    as_of: date,
    run: dict,
    setups: list[dict],
    watchlist: list[dict],
    app_base: str,
) -> str:
    macro = run.get("macro") or {}
    lines = [
        f"ORBIS EQUITY — Sunday research notes ({as_of.isoformat()})",
        "",
        run.get("headline") or "",
        "",
        "=== Macro ===",
        macro.get("headline") or "",
    ]
    for line in macro.get("narrative") or []:
        lines.append(f"  • {line}")
    lines.extend(["", "=== Watchlist leaders (trend radar GREEN) ==="])
    if not watchlist:
        lines.append("  (none)")
    for w in watchlist:
        lines.append(
            f"  {w['symbol']:6} rank {w.get('quality_rank')} conv {w.get('convergence_count')} "
            f"{w.get('entry_timing') or 'ok'} — {w.get('company_name') or w.get('sector') or ''}"
        )
    lines.extend(["", "=== Weekly setups (entry / stop / target) ==="])
    if not setups:
        lines.append("  No setups this week — check /research-weekly after pipeline run.")
    for i, s in enumerate(setups, 1):
        lines.append(
            f"  {i}. {s['symbol']} entry {s.get('entry_px')} stop {s.get('stop_px')} "
            f"target {s.get('target_px')} R:R {s.get('rr')}"
        )
        if s.get("theme"):
            lines.append(f"     {s['theme']}")
        if s.get("rationale"):
            lines.append(f"     {s['rationale']}")
    for note in run.get("risk_notes") or []:
        lines.extend(["", f"• {note}"])
    if app_base:
        lines.extend(["", f"Full pack: {app_base.rstrip('/')}/research-weekly"])
    lines.extend(
        [
            "",
            "Paper research only. Valid only if price reaches entry. Not investment advice.",
        ]
    )
    return "\n".join(lines)


def format_digest_html(
    *,
    as_of: date,
    run: dict,
    setups: list[dict],
    watchlist: list[dict],
    app_base: str,
) -> str:
    macro = run.get("macro") or {}
    wl_rows = "".join(
        f"<tr><td style='padding:4px 8px'>{w['symbol']}</td>"
        f"<td style='padding:4px 8px'>{w.get('quality_rank')}</td>"
        f"<td style='padding:4px 8px'>{w.get('convergence_count')}</td>"
        f"<td style='padding:4px 8px'>{w.get('entry_timing') or 'ok'}</td>"
        f"<td style='padding:4px 8px'>{w.get('company_name') or ''}</td></tr>"
        for w in watchlist
    )
    setup_blocks = "".join(
        f"<li><strong>{s['symbol']}</strong> — entry {s.get('entry_px')}, "
        f"stop <span style='color:#c44'>{s.get('stop_px')}</span>, "
        f"target <span style='color:#2a7'>{s.get('target_px')}</span> "
        f"(R:R {s.get('rr')})<br/><small>{s.get('rationale') or ''}</small></li>"
        for s in setups
    )
    narrative = "".join(f"<li>{line}</li>" for line in (macro.get("narrative") or []))
    risk = "".join(f"<li>{n}</li>" for n in (run.get("risk_notes") or []))
    link = (
        f"<p><a href='{app_base.rstrip('/')}/research-weekly'>Open research weekly in ORBIS</a></p>"
        if app_base
        else ""
    )
    return (
        f"<div style='font-family:system-ui,sans-serif;max-width:640px'>"
        f"<h2>ORBIS Sunday research — {as_of.isoformat()}</h2>"
        f"<p>{run.get('headline') or ''}</p>"
        f"<h3>Macro ({macro.get('symbol', 'SPY')})</h3>"
        f"<p>{macro.get('headline') or ''}</p><ul>{narrative}</ul>"
        f"<h3>Watchlist leaders</h3>"
        f"<table style='border-collapse:collapse;font-size:13px'>"
        f"<tr><th align='left'>Symbol</th><th>Rank</th><th>Conv</th><th>Timing</th><th>Name</th></tr>"
        f"{wl_rows or '<tr><td colspan=5>No GREEN names</td></tr>'}</table>"
        f"<h3>Weekly setups</h3><ol>{setup_blocks or '<li>No setups generated</li>'}</ol>"
        f"<h3>Risk &amp; process</h3><ul>{risk}</ul>"
        f"{link}"
        f"<p style='color:#666;font-size:12px'>Paper research only · not investment advice</p>"
        f"</div>"
    )


def run_digest(*, dry_run: bool = False, as_of: date | None = None) -> None:
    as_of = as_of or datetime.now(timezone.utc).date()
    sb_url = os.getenv("SUPABASE_URL", "")
    sb_key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sb_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")

    from supabase import create_client

    sb = create_client(sb_url, sb_key)
    run, setups, _run_id = load_or_refresh_pack(sb)
    watchlist = fetch_watchlist_leaders(sb)
    app_base = os.getenv("APP_BASE_URL", "").strip()

    text = format_digest_text(
        as_of=as_of, run=run, setups=setups, watchlist=watchlist, app_base=app_base
    )
    html = format_digest_html(
        as_of=as_of, run=run, setups=setups, watchlist=watchlist, app_base=app_base
    )
    subject = f"ORBIS Sunday research — {len(setups)} setup(s), {len(watchlist)} watchlist names"

    print(text)
    if dry_run:
        logger.info("Dry run — email not sent")
        return

    api_key = os.getenv("RESEND_API_KEY", "").strip()
    to_email = os.getenv("ALERT_EMAIL", "").strip()
    from_email = os.getenv("ALERT_EMAIL_FROM", DEFAULT_FROM).strip() or DEFAULT_FROM
    if not api_key or not to_email:
        logger.warning("Skipping send: set RESEND_API_KEY and ALERT_EMAIL")
        return

    result = send_resend_email(
        api_key=api_key,
        to_email=to_email,
        from_email=from_email,
        subject=subject,
        text=text,
        html=html,
    )
    logger.info("Sunday research email sent: %s", result.get("id", result))


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    load_dotenv()
    load_dotenv(".env.local")
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--as-of", default=None, help="YYYY-MM-DD")
    args = p.parse_args(argv)
    as_of = date.fromisoformat(args.as_of) if args.as_of else None
    run_digest(dry_run=args.dry_run, as_of=as_of)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
