"""EOD Trend Radar alert digest → email (Resend).

After nightly `trend_radar` compute, collect today's GREEN flips that pass
discretionary filters and email a short digest.

Usage:
    PYTHONPATH=/workspace python -m pipeline.notify.alert_digest
    PYTHONPATH=/workspace python -m pipeline.notify.alert_digest --dry-run

Env:
    SUPABASE_URL, SUPABASE_SERVICE_KEY  — required to fetch radar
    RESEND_API_KEY, ALERT_EMAIL         — required to send (else skip)
    ALERT_EMAIL_FROM                    — default: KovaView <onboarding@resend.dev>
    ALERT_MIN_RANK                      — default 60
    ALERT_MIN_CONVERGENCE               — default 4
    ALERT_SKIP_WAIT_PULLBACK            — default false
    APP_BASE_URL                        — optional link prefix (e.g. https://app.example.com)
"""
from __future__ import annotations

import argparse
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

import requests

logger = logging.getLogger(__name__)

DEFAULT_MIN_RANK = 60
DEFAULT_MIN_CONVERGENCE = 4
DEFAULT_FROM = "KovaView Alerts <onboarding@resend.dev>"
RESEND_URL = "https://api.resend.com/emails"


@dataclass(frozen=True)
class AlertCandidate:
    symbol: str
    quality_rank: int
    convergence_count: int
    entry_timing: str
    breakout_active: bool
    volume_confirmed: bool
    kama_regime: int
    adx: float | None
    state_changed_at: str
    company_name: str = ""
    sector: str = ""


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw.strip())


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def filter_alert_rows(
    radar_rows: list[dict[str, Any]],
    *,
    as_of: date,
    min_rank: int = DEFAULT_MIN_RANK,
    min_convergence: int = DEFAULT_MIN_CONVERGENCE,
    skip_wait_pullback: bool = False,
) -> list[dict[str, Any]]:
    """Pure filter: GREEN flips on as_of that pass rank/conv/timing gates."""
    as_of_s = as_of.isoformat()
    out: list[dict[str, Any]] = []
    for r in radar_rows:
        if int(r.get("state") or 0) != 1:
            continue
        changed = r.get("state_changed_at")
        if not changed or str(changed)[:10] != as_of_s:
            continue
        rank = int(r.get("quality_rank") or 0)
        conv = int(r.get("convergence_count") or 0)
        if rank < min_rank or conv < min_convergence:
            continue
        timing = str(r.get("entry_timing") or "ok")
        if timing == "too_late":
            continue
        if skip_wait_pullback and timing == "wait_pullback":
            continue
        out.append(r)
    out.sort(key=lambda x: (-int(x.get("quality_rank") or 0), x.get("symbol") or ""))
    return out


def rows_to_candidates(
    rows: list[dict[str, Any]],
    universe_map: dict[str, dict[str, Any]] | None = None,
) -> list[AlertCandidate]:
    uni = universe_map or {}
    candidates: list[AlertCandidate] = []
    for r in rows:
        sym = str(r.get("symbol") or "")
        u = uni.get(sym, {})
        adx_raw = r.get("adx")
        adx_val: float | None
        try:
            adx_val = float(adx_raw) if adx_raw is not None else None
        except (TypeError, ValueError):
            adx_val = None
        candidates.append(
            AlertCandidate(
                symbol=sym,
                quality_rank=int(r.get("quality_rank") or 0),
                convergence_count=int(r.get("convergence_count") or 0),
                entry_timing=str(r.get("entry_timing") or "ok"),
                breakout_active=bool(r.get("breakout_active")),
                volume_confirmed=bool(r.get("volume_confirmed")),
                kama_regime=int(r.get("kama_regime") or 0),
                adx=adx_val,
                state_changed_at=str(r.get("state_changed_at") or "")[:10],
                company_name=str(u.get("company_name") or ""),
                sector=str(u.get("sector") or ""),
            )
        )
    return candidates


def format_digest_text(
    candidates: list[AlertCandidate],
    *,
    as_of: date,
    app_base_url: str = "",
) -> str:
    lines = [
        f"KovaView EOD Alert Digest — {as_of.isoformat()}",
        "",
        "GREEN_FLIP candidates (manual / discretionary entry).",
        "Check SPY regime + chart before taking any trade.",
        "",
    ]
    if not candidates:
        lines.append("No qualifying GREEN flips today.")
        return "\n".join(lines)

    lines.append(f"{len(candidates)} alert(s):")
    lines.append("")
    for c in candidates:
        flags = []
        if c.breakout_active:
            flags.append("BRK")
        if c.volume_confirmed:
            flags.append("VOL")
        if c.kama_regime > 0:
            flags.append("KAMA+")
        if c.adx is not None and c.adx >= 20:
            flags.append(f"ADX{c.adx:.0f}")
        flag_s = ",".join(flags) if flags else "—"
        name = f" — {c.company_name}" if c.company_name else ""
        sector = f" [{c.sector}]" if c.sector else ""
        link = ""
        if app_base_url:
            link = f"  {app_base_url.rstrip('/')}/ticker/{c.symbol}"
        lines.append(
            f"  {c.symbol}{name}{sector}\n"
            f"    rank={c.quality_rank}  conv={c.convergence_count}/7  "
            f"timing={c.entry_timing}  {flag_s}{link}"
        )
    lines.append("")
    lines.append("Sizing hint: ATR×2.5 stop, ~1.25% equity risk (see atr_risk).")
    lines.append("Exit plan: SMA20 trail / RED / hard ATR stop.")
    return "\n".join(lines)


def format_digest_html(
    candidates: list[AlertCandidate],
    *,
    as_of: date,
    app_base_url: str = "",
) -> str:
    rows_html = []
    for c in candidates:
        href = (
            f"{app_base_url.rstrip('/')}/ticker/{c.symbol}"
            if app_base_url
            else ""
        )
        sym = (
            f'<a href="{href}">{c.symbol}</a>'
            if href
            else c.symbol
        )
        rows_html.append(
            "<tr>"
            f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{sym}</td>"
            f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{c.company_name}</td>"
            f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{c.quality_rank}</td>"
            f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{c.convergence_count}/7</td>"
            f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>{c.entry_timing}</td>"
            f"<td style='padding:6px 10px;border-bottom:1px solid #eee'>"
            f"{'BRK ' if c.breakout_active else ''}"
            f"{'VOL ' if c.volume_confirmed else ''}"
            f"{f'ADX {c.adx:.0f}' if c.adx is not None else ''}</td>"
            "</tr>"
        )
    body = (
        "<p>No qualifying GREEN flips today.</p>"
        if not candidates
        else (
            f"<p><strong>{len(candidates)}</strong> GREEN_FLIP candidate(s) "
            "for discretionary review. Confirm SPY regime before entry.</p>"
            "<table style='border-collapse:collapse;font-family:monospace;font-size:13px'>"
            "<thead><tr>"
            "<th align='left' style='padding:6px 10px'>Symbol</th>"
            "<th align='left' style='padding:6px 10px'>Name</th>"
            "<th align='left' style='padding:6px 10px'>Rank</th>"
            "<th align='left' style='padding:6px 10px'>Conv</th>"
            "<th align='left' style='padding:6px 10px'>Timing</th>"
            "<th align='left' style='padding:6px 10px'>Flags</th>"
            "</tr></thead>"
            f"<tbody>{''.join(rows_html)}</tbody></table>"
        )
    )
    return (
        f"<div style='font-family:system-ui,sans-serif'>"
        f"<h2>KovaView EOD Alert Digest — {as_of.isoformat()}</h2>"
        f"{body}"
        "<p style='color:#666;font-size:12px;margin-top:16px'>"
        "ATR×2.5 stop · ~1.25% equity risk · prefer SMA20 trail / exit on RED"
        "</p></div>"
    )


def send_resend_email(
    *,
    api_key: str,
    to_email: str,
    from_email: str,
    subject: str,
    text: str,
    html: str,
) -> dict[str, Any]:
    resp = requests.post(
        RESEND_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "from": from_email,
            "to": [to_email],
            "subject": subject,
            "text": text,
            "html": html,
        },
        timeout=30,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Resend HTTP {resp.status_code}: {resp.text[:500]}")
    return resp.json() if resp.content else {}


def fetch_radar_and_universe(sb: Any) -> tuple[list[dict], dict[str, dict]]:
    radar: list[dict] = []
    page = 1000
    offset = 0
    while True:
        resp = (
            sb.table("trend_radar")
            .select(
                "symbol,state,quality_rank,convergence_count,entry_timing,"
                "breakout_active,volume_confirmed,kama_regime,adx,state_changed_at"
            )
            .eq("state", 1)
            .order("quality_rank", desc=True)
            .range(offset, offset + page - 1)
            .execute()
        )
        batch = resp.data or []
        radar.extend(batch)
        if len(batch) < page:
            break
        offset += page

    uni_resp = (
        sb.table("universe_members")
        .select("symbol,company_name,sector")
        .eq("is_active", True)
        .execute()
    )
    uni_map = {r["symbol"]: r for r in (uni_resp.data or [])}
    return radar, uni_map


def run_digest(
    *,
    as_of: date | None = None,
    dry_run: bool = False,
    min_rank: int | None = None,
    min_convergence: int | None = None,
    skip_wait_pullback: bool | None = None,
) -> list[AlertCandidate]:
    as_of = as_of or datetime.now(timezone.utc).date()
    min_rank = min_rank if min_rank is not None else _env_int(
        "ALERT_MIN_RANK", DEFAULT_MIN_RANK
    )
    min_convergence = min_convergence if min_convergence is not None else _env_int(
        "ALERT_MIN_CONVERGENCE", DEFAULT_MIN_CONVERGENCE
    )
    if skip_wait_pullback is None:
        skip_wait_pullback = _env_bool("ALERT_SKIP_WAIT_PULLBACK", False)

    from pipeline.utils.client import get_supabase

    sb = get_supabase()
    radar, uni_map = fetch_radar_and_universe(sb)
    filtered = filter_alert_rows(
        radar,
        as_of=as_of,
        min_rank=min_rank,
        min_convergence=min_convergence,
        skip_wait_pullback=skip_wait_pullback,
    )
    candidates = rows_to_candidates(filtered, uni_map)

    app_base = os.getenv("APP_BASE_URL", "").strip()
    text = format_digest_text(candidates, as_of=as_of, app_base_url=app_base)
    html = format_digest_html(candidates, as_of=as_of, app_base_url=app_base)
    subject = f"Orbis Equity alerts {as_of.isoformat()} — {len(candidates)} GREEN flip(s)"

    logger.info("Digest prepared: %d candidates for %s", len(candidates), as_of)
    print(text)

    if dry_run:
        logger.info("Dry run — email not sent")
        return candidates

    api_key = os.getenv("RESEND_API_KEY", "").strip()
    to_email = os.getenv("ALERT_EMAIL", "").strip()
    from_email = os.getenv("ALERT_EMAIL_FROM", DEFAULT_FROM).strip() or DEFAULT_FROM

    if not api_key or not to_email:
        logger.warning(
            "Skipping send: set RESEND_API_KEY and ALERT_EMAIL to enable email delivery"
        )
        return candidates

    result = send_resend_email(
        api_key=api_key,
        to_email=to_email,
        from_email=from_email,
        subject=subject,
        text=text,
        html=html,
    )
    logger.info("Email sent via Resend: %s", result.get("id", result))
    return candidates


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true", help="Print digest; do not send")
    p.add_argument("--as-of", default=None, help="YYYY-MM-DD (default: UTC today)")
    p.add_argument("--min-rank", type=int, default=None)
    p.add_argument("--min-convergence", type=int, default=None)
    p.add_argument(
        "--skip-wait-pullback",
        action=argparse.BooleanOptionalAction,
        default=None,
    )
    args = p.parse_args(argv)
    as_of = date.fromisoformat(args.as_of) if args.as_of else None
    from dotenv import load_dotenv

    load_dotenv()
    run_digest(
        as_of=as_of,
        dry_run=args.dry_run,
        min_rank=args.min_rank,
        min_convergence=args.min_convergence,
        skip_wait_pullback=args.skip_wait_pullback,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
