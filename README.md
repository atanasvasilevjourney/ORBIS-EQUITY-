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
universe → prices → fundamentals → financial reports → trend radar → F-Score → factor scores → portfolio loop → skew map → earnings → news → clinical trials → health signals

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

Surfaced at `/skew` and `GET /api/skew`. Yahoo mids, not a calibrated vol model. Not investment advice.

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
