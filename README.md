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
11. **TEMA + Carver Perps** — TEMA 8/21/55 and Carver EWMAC sleeves on listed names, sized as USDT-M perpetuals

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
universe → prices → fundamentals → financial reports → trend radar → F-Score → factor scores → portfolio loop → skew map → opening range → stock analysis → Quantropy → daily bias → TEMA/Carver perps → earnings → news → clinical trials → health signals

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

## TEMA + Carver perps (levered equity via USDT-M)

[QMIE](https://github.com/atanasvasilevjourney/QMIE) is a **crypto USDT-perp scanner** (manual-entry, no broker). It does **not** implement strategies named TEMA or Carver. This desk is a **separate** KovaView section that maps those two ideas onto listed equities and sizes them as isolated perpetuals:

| Sleeve | Signal | Book | Perp overlay |
|---|---|---|---|
| **TEMA** (50% of $100k) | Triple EMA 8/21/55 stack; grade B+ (daily equity; QMIE A is 1h/4h crypto) | Ranked 3 long + 3 short, sector cap 2, 1.5 ATR stop / 2.5 ATR target, 2% of slot at the stop | Isolated USDT-M, cap 5x, liq from 0.5% MMR |
| **Carver** (50% of $100k) | EWMAC 16/64 + 32/128, scalars 3.75 / 2.65, forecast clip ±20 | Vol-target 25% with IDM 1.2, skip \|forecast\| < 5, gross cap 3x | Same isolated overlay; funding skip at ±0.1%/8h when a venue tape exists |

Contract = `{TICKER}USDT`. Marks and 8h funding are pulled from public Bybit then Binance when the host can reach them. This environment often cannot (geo-block) — those names stay **synthetic** and still size off equity EOD. Funding, basis, 24×7 liquidation, and USD-M vs coin-M are risks LOOP's 2N cash book does not have.

Do **not** vendor QMIE (no license on that repo). Do **not** mix this book into LOOP / ORB / BIAS.

```bash
python -m pipeline.compute.perps_desk
```

Surfaced at `/perps` and `GET /api/perps`. Paper harness only — no live exchange orders. Not investment advice.

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
