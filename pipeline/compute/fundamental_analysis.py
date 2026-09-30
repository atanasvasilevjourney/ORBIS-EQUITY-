"""Statement-derived fundamental analysis / verdict.

Builds a short automated assessment from:
  - Piotroski F-Score (+ component detail)
  - Multi-factor scores (value / quality / growth / earnings quality / leverage)
  - Statement extras (accruals, interest coverage)
  - Snapshot margins / growth

Verdicts: STRONG | ATTRACTIVE | NEUTRAL | WEAK | DISTRESSED | INSUFFICIENT

Usage (usually called from f_score / factor_scores pipeline):
    from pipeline.compute.fundamental_analysis import build_fundamental_analysis
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


VERDICTS = ("STRONG", "ATTRACTIVE", "NEUTRAL", "WEAK", "DISTRESSED", "INSUFFICIENT")


@dataclass(frozen=True)
class FundamentalAnalysis:
    verdict: str
    summary: str
    bullets: list[str]
    score_hint: int | None  # 0-100 informal quality tilt

    def as_row_fields(self) -> dict[str, Any]:
        return {
            "fundamental_verdict": self.verdict,
            "fundamental_summary": self.summary,
        }


def _pct(v: float | None) -> str:
    if v is None:
        return "—"
    return f"{v * 100:.1f}%"


def build_fundamental_analysis(
    *,
    f_score: int | None,
    f_score_detail: dict[str, Any] | None = None,
    composite_factor_score: int | None = None,
    value_score: int | None = None,
    quality_score: int | None = None,
    growth_score: int | None = None,
    earnings_quality_score: int | None = None,
    leverage_score: int | None = None,
    pe_ratio: float | None = None,
    roe: float | None = None,
    net_margin: float | None = None,
    revenue_growth_1y: float | None = None,
    debt_to_equity: float | None = None,
    accruals_ratio: float | None = None,
    interest_coverage: float | None = None,
) -> FundamentalAnalysis:
    """Derive verdict + human-readable summary from available fundamentals."""
    bullets: list[str] = []
    points = 0
    weight = 0

    # F-Score (0-9) → up to 40 points
    if f_score is not None:
        weight += 40
        points += (f_score / 9.0) * 40
        if f_score >= 7:
            bullets.append(f"Piotroski F-Score {f_score}/9 — strong balance-sheet / earnings quality")
        elif f_score <= 3:
            bullets.append(f"Piotroski F-Score {f_score}/9 — weak fundamental momentum")
        else:
            bullets.append(f"Piotroski F-Score {f_score}/9 — mixed")

        if f_score_detail and isinstance(f_score_detail.get("components"), dict):
            failed = [k for k, v in f_score_detail["components"].items() if not v]
            if failed and f_score < 7:
                bullets.append("Failed F-tests: " + ", ".join(failed[:4]))

    # Composite factor (0-100) → up to 35 points
    if composite_factor_score is not None:
        weight += 35
        points += (composite_factor_score / 100.0) * 35
        if composite_factor_score >= 70:
            bullets.append(f"Multi-factor composite {composite_factor_score} — top-tier screen")
        elif composite_factor_score <= 30:
            bullets.append(f"Multi-factor composite {composite_factor_score} — bottom-tier screen")

    # Earnings quality / accruals → up to 15 points
    if earnings_quality_score is not None:
        weight += 15
        points += (earnings_quality_score / 100.0) * 15
    if accruals_ratio is not None:
        if accruals_ratio > 0.02:
            bullets.append(f"Cash earnings beat accruals (accruals ratio {accruals_ratio:.3f})")
        elif accruals_ratio < -0.02:
            bullets.append(f"Earnings ahead of cash (accruals ratio {accruals_ratio:.3f}) — watch quality")

    # Leverage / coverage → up to 10 points
    if leverage_score is not None:
        weight += 10
        points += (leverage_score / 100.0) * 10
    if interest_coverage is not None:
        if interest_coverage < 2:
            bullets.append(f"Interest coverage {interest_coverage:.1f}x — thin")
        elif interest_coverage >= 8:
            bullets.append(f"Interest coverage {interest_coverage:.1f}x — comfortable")

    # Snapshot color
    if roe is not None:
        bullets.append(f"ROE {_pct(roe)}")
    if net_margin is not None:
        bullets.append(f"Net margin {_pct(net_margin)}")
    if revenue_growth_1y is not None:
        bullets.append(f"Revenue growth 1Y {_pct(revenue_growth_1y)}")
    if pe_ratio is not None and pe_ratio > 0:
        bullets.append(f"P/E {pe_ratio:.1f}")
    if debt_to_equity is not None:
        bullets.append(f"D/E {debt_to_equity:.2f}")

    # Factor tilt notes
    tilts = []
    for label, sc in (
        ("value", value_score),
        ("quality", quality_score),
        ("growth", growth_score),
    ):
        if sc is not None and sc >= 70:
            tilts.append(label)
    if tilts:
        bullets.append("Factor tilt: " + ", ".join(tilts))

    if weight == 0:
        return FundamentalAnalysis(
            verdict="INSUFFICIENT",
            summary="Not enough fundamental / statement data for an automated verdict.",
            bullets=bullets[:6],
            score_hint=None,
        )

    score_hint = int(round(points / weight * 100))

    # Distressed overrides
    if (f_score is not None and f_score <= 2) or (
        composite_factor_score is not None and composite_factor_score <= 20
    ):
        verdict = "DISTRESSED"
    elif score_hint >= 75 and (f_score is None or f_score >= 6):
        verdict = "STRONG"
    elif score_hint >= 60:
        verdict = "ATTRACTIVE"
    elif score_hint >= 40:
        verdict = "NEUTRAL"
    else:
        verdict = "WEAK"

    summary = (
        f"{verdict}: quality tilt ~{score_hint}/100"
        + (f", F-Score {f_score}/9" if f_score is not None else "")
        + (
            f", composite {composite_factor_score}"
            if composite_factor_score is not None
            else ""
        )
        + "."
    )

    return FundamentalAnalysis(
        verdict=verdict,
        summary=summary,
        bullets=bullets[:8],
        score_hint=score_hint,
    )


def analysis_to_json(analysis: FundamentalAnalysis) -> dict[str, Any]:
    return asdict(analysis)
