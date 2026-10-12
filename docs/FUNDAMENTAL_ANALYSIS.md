# Fundamental Analysis

KovaView stores **full financial statements** and runs automated fundamental
analysis on top of them. This is an equity EOD overlay for discretionary swing
risk — **not** an earnings-beat email alert.

## Do we have financial statements?

**Yes.** Table `financial_reports` (LSE `z_financial_reports`) stores FY
JSONB blobs for:

| `report_type` | Contents |
|---------------|----------|
| `income` | Revenue, gross profit, operating income, NI, EPS, shares |
| `balance` | Assets, liabilities, equity, debt, cash, current items |
| `cashflow` | Operating CF, capex, FCF, dividends, buybacks |
| `metrics` | ROE/ROA/ROIC, yields, EV multiples |
| `growth` | YoY growth rates from the vendor feed |

Ingest: `python -m pipeline.ingest.financial_reports` (paginated, universe-filtered).
Nightly Monday job in `.github/workflows/nightly-pipeline.yml`.

Latest snapshot ratios live in `fundamentals_snapshot` (P/E, margins, growth,
dividends, etc.).

## Automated analysis (what runs)

| Step | Module | Output |
|------|--------|--------|
| Piotroski F-Score | `pipeline.compute.f_score` | `f_score` (0–9) + **`f_score_detail`** (9 boolean tests) |
| Multi-factor ranks | `pipeline.compute.factor_scores` | value / quality / growth / earnings quality / leverage / composite (0–100), accruals, interest coverage |
| Verdict | `pipeline.compute.fundamental_analysis` | **`fundamental_verdict`** + **`fundamental_summary`** |

Verdicts: `STRONG` · `ATTRACTIVE` · `NEUTRAL` · `WEAK` · `DISTRESSED` · `INSUFFICIENT`.

Migration: `supabase/migrations/021_fundamental_analysis.sql`.

## Where to see it

- **Ticker → FUNDAMENTALS**: auto analysis banner, F-Score checklist, factor cards, FY statement tabs (Income / Balance / Cash Flow / **Metrics** / **Growth**)
- **/fundamentals**: multi-factor screener with **verdict** column + filter
- APIs: `GET /api/fundamentals`, `GET /api/fundamentals/[ticker]` (`analysis` + statement series)

## What it is not

- Not an intraday “NVDA beat → bullish email” system
- Earnings surprises stay on the EARNINGS tab / calendar ingest
- Swing email digest remains Trend Radar GREEN flips only

## Recompute locally

```bash
PYTHONPATH=/workspace python -m pipeline.compute.f_score
PYTHONPATH=/workspace python -m pipeline.compute.factor_scores
```
