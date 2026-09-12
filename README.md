# KovaView Terminal

Systematic equity research terminal — momentum screener, multi-factor fundamentals, earnings & news.

## Stack

- **Frontend**: Next.js 14, React, Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Pipeline**: Python 3.12 (nightly GitHub Actions)

## Modules

1. **Swing Screener** — trend radar signals (momentum, EWMAC, breakout, volume)
2. **Quant Fundamentals** — cross-sectional factor scores (value, quality, growth, earnings quality, leverage) + Piotroski F-Score
3. **Health Sector** — pharma/biotech fundamentals + clinical-trial catalyst calendar (ClinicalTrials.gov)
4. **Loop Terminal** — equity breakout paper portfolio (2N ATR sizing, sector caps, orders)
5. **Earnings & News** — calendar + GDELT headlines
6. **Skew Map** — listed IV surface (skew, term, weekend vol) from yfinance option chains
7. **Opening Range Breakout** — premarket/open gappers, 15-minute OR, long-only 1R paper brackets
8. **Stock Analysis** — technical MA/MACD/RSI/regression plus fundamental composite & F-Score
9. **Quantropy** — risk, CAPM, Altman Z, Markowitz allocation (port of the Quantropy/Matilda library)
10. **Daily Bias** — TradingView-style chart, key levels, paper trade ideas (ANALYZE vote + ATR pivots)
11. **TEMA + Carver Cash** — TEMA 9/99/199 swing with MACD(12,26,9) close, and Carver EWMAC, sized as fully funded cash shares at the listed close
12. **Beta Rotation** — macro canaries → GICS sector → nested sub-sectors → TEMA ensemble, then Carver D-rungs (DCA on the bigger trend) rotate into the leading sleeve / names

## Setup

### Environment

Copy `.env.example` to `.env.local` (web) and `.env` (pipeline):

```bash
cp .env.example .env.local
```

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser + API routes
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — Python pipeline writes
- `LSE_API_KEY` — London Strategic Edge data API (optional for bootstrap)

### Database

Apply migrations in order:

```bash
# Via Supabase CLI or SQL editor
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_financial_reports.sql
supabase/migrations/003_rls_and_pharma_upsert.sql
supabase/migrations/004_fix_pharma_signals_constraint.sql
supabase/migrations/005_precision_and_fk.sql
supabase/migrations/006_equity_factors.sql
supabase/migrations/007_paper_loop.sql
supabase/migrations/008_skew_map.sql
supabase/migrations/009_orb.sql
supabase/migrations/010_analysis.sql
supabase/migrations/011_quantropy.sql
supabase/migrations/012_daily_bias.sql
supabase/migrations/013_qmie_perps.sql
supabase/migrations/014_perps_macd.sql
supabase/migrations/015_sector_rotation.sql
supabase/migrations/016_macro_canaries.sql
supabase/migrations/017_subsector_parent.sql
supabase/migrations/018_rotate_carver.sql
supabase/migrations/019_cash_book.sql
supabase/migrations/020_ingest_runs.sql
```

### Web

```bash
npm install
npm run dev
```

### Pipeline (bootstrap without LSE API key)

```bash
pip install -r pipeline/requirements.txt
python -m pipeline.bootstrap
```

Listed cash EOD (no LSE key) — same public-REST / closed-bar shape as QMIE,
Yahoo then Stooq, not Binance perps:

```bash
python -m pipeline.ingest.cash_eod
```

### GitHub Actions secrets (required for nightly pipeline)

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `SUPABASE_URL` | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase **service_role** key (Settings → API) |
| `LSE_API_KEY` | London Strategic Edge API key |

Optional: `LSE_DATA_API_URL` (defaults to `https://data-api.londonstrategicedge.com`)

Without these secrets the nightly pipeline will fail immediately with a clear error.

Runs nightly via `.github/workflows/nightly-pipeline.yml`:
universe → prices → fundamentals → financial reports → trend radar → F-Score → factor scores → portfolio loop → skew map → opening range → stock analysis → Quantropy → daily bias → TEMA/Carver cash → beta rotation → earnings → news → clinical trials → health signals

## Health Sector (free data, no API key)

Pharma/biotech catalysts come from the **ClinicalTrials.gov Data API v2** — a free, public-domain, key-less REST API. For every Health Care universe member, the pipeline pulls that company's recent interventional trials (by lead sponsor) and derives forward-looking catalyst signals (upcoming readouts, recent readouts, posted results) with a phase-weighted confidence.

```bash
python -m pipeline.ingest.pharma_trials    # ClinicalTrials.gov → pharma_trials
python -m pipeline.compute.pharma_signals  # pharma_trials → pharma_signals
```

Surfaced in the UI at `/health` and via `GET /api/health`. Signals are heuristic and not investment advice.

## Loop Terminal (paper breakout book)

Turns Trend Radar into a mechanical long-only paper portfolio:

- **Entry:** GREEN + rank ≥ 60 + positive momentum/EWMAC + (breakout or volume confirm)
- **Size:** Turtle-style — `shares = floor((equity × 1%) / (2N))` with N = 14-day ATR
- **Stop:** 2N below entry; max 8 names, max 2 per sector, 8% open heat
- **Skip:** earnings in next 5 days, insufficient ATR, posture &lt; 50 (no new entries)
- **Exit:** stop hit, state RED, rank decay, dual-momentum failure

```bash
python -m pipeline.compute.portfolio_loop
```

Surfaced at `/loop` and `GET /api/loop`. Paper harness only — no live broker orders. Not investment advice.

## Skew Map (listed IV + weekend vol)

Builds a live implied-vol map from **yfinance option chains** (free, no API key) for a liquid set (SPY, QQQ, IWM, mega-cap names; override with `SKEW_TICKERS`).

- **Skew slice:** IV vs strike at each expiry — OTM puts below spot, OTM calls above (what traders pay for crash vs squeeze)
- **Term:** ATM IV vs calendar DTE
- **Surface:** moneyness × DTE grid
- **Weekend vol:** calendar-time variance between the nearest Friday expiry and the following Monday (`var = IV² × DTE/365`; weekend = Monday − Friday). A ratio above 1 is weekend event premium; below 1 is cheap calendar time with markets closed.

```bash
python -m pipeline.compute.skew_map
```

Surfaced at `/skew` and `GET /api/skew`. IV is inverted from listed last/mid (Yahoo's `impliedVolatility` is unusable when bid/ask are 0). Not a calibrated vol model. Not investment advice.

## Opening Range Breakout (paper)

Port of [michaelzheng67/Full-Stack-Stock-Algorithm](https://github.com/michaelzheng67/Full-Stack-Stock-Algorithm) without Alpaca. Long-only:

1. Screen opening gappers: `|open / prev_close − 1| ≥ 4%`
2. Opening range = 09:30–09:45 America/New_York on 5-minute bars
3. Buy the first 5m close after 09:45 above the OR high
4. Bracket: take-profit = entry + OR, stop = entry − OR (1R)
5. Size: `floor((equity × 5%) / price)` on a $100k paper book, max 8 names

```bash
python -m pipeline.compute.opening_range
```

Surfaced at `/orb` and `GET /api/orb`. Paper harness only — no live broker orders. Not investment advice.

## Stock Analysis (technical + fundamental)

Port of [MorcilloSanz/stockanalysis](https://github.com/MorcilloSanz/stockanalysis) onto `prices_daily`:

- **Long-term:** SMA 100/200, EMA 50/100, linear-regression slope, Golden/Death Cross
- **Mid-term:** SMA 50/100, EMA 20/50, MACD, RSI, price/volume decision tree
- **Vote:** majority of the six technical codes (min 2), with composite factor score and Piotroski F-Score shown beside the tape

```bash
python -m pipeline.compute.stock_analysis
```

Surfaced at `/analysis` and `GET /api/analysis`. Heuristic signals — not investment advice.

## Quantropy (risk + allocation)

Port of [atanasvasilevjourney/Quantropy](https://github.com/atanasvasilevjourney/Quantropy) (Matilda) onto KovaView daily bars. No Alpaca, no Ken-French file drop.

- **Risk:** annual vol, Sharpe, Sortino, max drawdown, historical VaR/CVaR 5%
- **CAPM:** alpha and beta vs the equal-weight universe
- **Distress:** public-firm Altman Z (safe &gt; 2.99 / grey / distress &lt; 1.81)
- **Allocation:** equal, inverse-vol, min-variance, max-Sharpe, Markowitz efficient frontier (long-only SLSQP)

```bash
python -m pipeline.compute.quantropy
```

Surfaced at `/quantropy` and `GET /api/quantropy`. Paper analytics — not a broker, not investment advice.

## Daily Bias (chart + paper ideas)

Annotated tape for a selected name, in the style of a daily-bias card:

- **Chart:** TradingView `lightweight-charts` candlesticks (daily from `prices_daily`, optional live 5m from Yahoo)
- **Levels:** classic floor pivots from the prior session, swing high/low, SMA 20/50, prior high/low, OR high/low when the ORB desk has them
- **Bias:** ANALYZE majority vote (fallback: close vs SMA50 + RSI + MACD)
- **Ideas:** fade S1/R1 and break of prior high/low, stop ≥ 0.75×ATR, skip if R:R &lt; 1.2
- **Range:** last close ± 0.75×ATR, with IF reclaim / IF breakdown scenarios

No GEX, no absorption lots, no MaxSell walls — this book does not have that tape.

```bash
python -m pipeline.compute.daily_bias
```

Surfaced at `/bias`, ticker **CHART** tab, `GET /api/bias`, and `GET /api/chart/[ticker]`. Paper ideas — not live orders, not investment advice.

## TEMA + Carver cash (listed stock, fully funded)

[QMIE](https://github.com/atanasvasilevjourney/QMIE) is a **crypto USDT-perp scanner**. It does **not** implement TEMA or Carver. This desk maps those two ideas onto **listed cash equities** at the `prices_daily` close. No Bybit/Binance mark, no funding, no liquidation.

Cash EOD ingest copies QMIE's *ingestion shape* (public REST, provider fallback, drop the in-progress session bar, ~300 daily closes) onto **Yahoo → Stooq**. It does **not** pull USDT-M klines or vendor QMIE's exchange clients.

| Sleeve | Signal | Book | Cash size |
|---|---|---|---|
| **TEMA** (50% of $100k) | Triple EMA **9/99/199**: 9 vs 99 is the trigger, 199 is the regime. **MACD(12,26,9)** is the systematic close. Grade B+ and MACD HOLD to stay in the book. | Ranked 3 long + 3 short, sector cap 2, 2.5 ATR hard stop. | Shares = cash $ / last close, capped at the slot's allocated cash |
| **Carver** (50% of $100k) | EWMAC 16/64 + 32/128, clip ±20 | Vol-target 25%, IDM 1.2. **Drawdown scalar** 1.0 until 10% EW-universe DD, 0 at 25%. **Rotation:** LIVE / REDUCE / CASH | Same fully funded cap. Gross ≤ 1× sleeve equity |

Longs are paper long stock. Shorts are paper shorts of the listed name (no borrow / locate). That is more honest than a synthetic `{TICKER}USDT` perp this host usually cannot reach.

Do **not** vendor QMIE. Do **not** mix this book into LOOP / ORB / BIAS / ROTATE.

```bash
python -m pipeline.compute.perps_desk
```

Surfaced at `/cash` (`/perps` redirects) and `GET /api/perps`. Paper harness only. Not investment advice.

## Beta rotation (which sectors are trending)

Inspired by [Caltropia's 2026 sector and industry outlook](https://caltropia.substack.com/p/2026-stock-market-sector-and-industry) **structure** and the canary → TEMA-MACD ensemble flow from the Crypto Allocation notebook. Not their published numbers.

**Flow:** macro canary votes → which sectors are trending → drill into that sector's sub-sectors (Energy → Solar / Nuclear / Oil & Gas, …) → TEMA-MACD ensemble in that sleeve → **Carver D-rungs** (HOW MUCH) as discrete DCA partials on the *bigger* sector trend, rotated into the leading sub-sector and its top names (HedgeFund_WiP Strategy 19-lite, isolated from the PERPS Carver book).

Parent EWMAC unlocks D1–D4 at |forecast| 5 / 10 / 15 / 20. Rungs land only on canary-aligned sectors, the leading sleeve, and names whose own forecast agrees. Losing sleeves stay FLAT so the same risk budget can rotate. Vol-target 25%, 20% name cap, universe drawdown scalar. Paper $100k sleeve — not a live book.

Canaries are equal-weight **basket proxies** (QQQ/SPY ≈ Tech/Universe, XLY/XLP ≈ Discretionary/Staples, XLU/SPY inverted defensives, XLE/SPY, HYG/LQD ≈ Financials/Staples, universe vs 200-SMA). Each print is a 126-day z-score, 10-day causal smooth, then +1/0/−1. TEMA ensemble is a compact Fast/Slow TEMA-MACD grid (hist &gt; 0 = long). The 9/99/199 swing stays a separate column.

For every GICS sector and industry in the universe we also compute:

| Field | Meaning |
|---|---|
| Current breadth | share of names with a positive 20d return |
| Momentum breadth | share with a positive 60d return |
| Value / low-vol breadth | value-score ≥ 50; 20d σ below the universe median |
| Impulse | this week's 5d return minus last week's |
| Stretch | share with 20d return z-score > 2 |
| β 60 | OLS beta of equal-weight group vs equal-weight universe |
| 8W heatmap | weekly equal-weight returns, oldest → newest |
| Label | LEAD / ACCEL / FADE / REPAIR / LAG |
| Regime | RISK-ON if cyclicals lead on 4-week RS, RISK-OFF if defensives do |

```bash
python -m pipeline.compute.sector_rotation
```

Surfaced at `/rotate` and `GET /api/rotate`. Paper diagnostic. Not investment advice.

## Factor Scores

Computed nightly by `pipeline/compute/factor_scores.py`:

| Factor | Weight | Inputs |
|--------|--------|--------|
| Value | 25% | P/E, P/B, EV/EBITDA, earnings yield, FCF yield |
| Quality | 25% | ROE, ROIC, margins, Piotroski F-Score |
| Growth | 20% | Revenue/EPS growth (1y, 3y) |
| Earnings Quality | 15% | Accruals ratio (CFO − NI) / assets |
| Leverage | 15% | Current ratio, D/E, interest coverage |

Scores are cross-sectional percentile ranks (0–100). Composite score is the weighted blend.

## API

All routes under `/api/*` are readable by the UI. External access requires `x-api-key` header when `API_SECRET` is set.
