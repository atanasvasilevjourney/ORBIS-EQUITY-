# KovaView Terminal

Systematic equity research terminal — momentum screener, multi-factor fundamentals, earnings & news.

## Stack

- **Frontend**: Next.js 14, React, Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Pipeline**: Python 3.12 (nightly GitHub Actions)

## Modules

1. **Swing Screener** — trend radar signals (momentum, EWMAC, breakout, volume)
2. **Quant Fundamentals** — cross-sectional factor scores (value, quality, growth, earnings quality, leverage) + Piotroski F-Score
3. **Earnings & News** — calendar + GDELT headlines

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

### Pipeline (production with LSE API)

Runs nightly via `.github/workflows/nightly-pipeline.yml`:
universe → prices → fundamentals → financial reports → trend radar → F-Score → factor scores → earnings → news

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
