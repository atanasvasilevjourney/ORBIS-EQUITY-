# Deploy Orbis Equity (online)

Goal: **Next.js app on Vercel**, **Python data pipeline on Render Cron**, **data in Supabase**.

```text
Browser → Vercel (Next.js) → Supabase
Render Cron (pipeline) ─────→ Supabase
```

---

## 0. Prerequisites

| Account | Why |
|---------|-----|
| [Supabase](https://supabase.com) | Database (tables from `supabase/migrations`) |
| [Vercel](https://vercel.com) | Host the terminal UI |
| [Render](https://render.com) | Run weekday data jobs |
| GitHub repo connected to both | This repository |

Apply migrations in Supabase SQL editor (or CLI) if the project is empty: run **all** files in `supabase/migrations/` in filename order (`001` → `020`, including desk/KAMA migrations). Do not stop at `005` — cloud desk modules need `006`+.

---

## 1. Supabase env values

In Supabase → Project Settings → API:

- **Project URL** → `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`
- **service_role** key (secret) → `SUPABASE_SERVICE_KEY`
- **anon** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional: LSE key → `LSE_API_KEY` (production fundamentals/US prices). Without it, use **bootstrap** (yfinance S&P 500) first.

---

## 2. Deploy app → Vercel

1. Open https://vercel.com/new → **Import** this GitHub repo.
2. Framework preset: **Next.js** (auto). Root: `.`
3. **Environment Variables** (Production + Preview):

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_URL` | same project URL |
| `SUPABASE_SERVICE_KEY` | service_role key |
| `ALLOWED_ORIGIN` | your Vercel domain, e.g. `orbis-equity.vercel.app` |
| `API_SECRET` | random string (enables `x-api-key` on `/api/*`; leave empty only for open demo) |
| `RESEND_API_KEY` | optional — EOD GREEN_FLIP alert digest |
| `ALERT_EMAIL` / `ALERT_EMAIL_FROM` | optional — digest recipients |
| `APP_BASE_URL` | optional — deep links in alert emails |

4. Deploy. Open `https://<project>.vercel.app`.
5. After first deploy, set `ALLOWED_ORIGIN` to that host and redeploy if Server Actions warn.

`vercel.json` is already in the repo.

---

## 3. Deploy pipeline → Render

1. Open https://dashboard.render.com/blueprints → **New Blueprint Instance**.
2. Connect the same repo. Render reads `render.yaml`.
3. Create/fill env group **`orbis-equity-pipeline`**:

| Name | Required |
|------|----------|
| `SUPABASE_URL` | yes |
| `SUPABASE_SERVICE_KEY` | yes |
| `LSE_API_KEY` | recommended for LSE path |
| `LSE_API_URL` / `LSE_DATA_API_URL` | prefilled |

4. Approve services:
   - `orbis-equity-bootstrap` (manual)
   - `orbis-equity-weekly` (Mon 19:00 UTC)
   - `orbis-equity-daily` (Tue–Fri 19:30 UTC)

5. **Critical first run:** Render → `orbis-equity-bootstrap` → **Manual Trigger**.  
   Wait until it finishes (S&P history + radar). Without this, daily jobs lack ≥148 price days and radar stays empty.

6. Optionally trigger `orbis-equity-daily` once to verify.

Scripts:

- `pipeline/scripts/run_bootstrap.sh`
- `pipeline/scripts/run_weekly.sh`
- `pipeline/scripts/run_daily.sh`

---

## 3b. London Strategic Edge live stream (optional)

Your `lse_live_…` key unlocks **candles + WebSocket ticks** (not the PostgREST screener).

1. Apply migration `021_live_quotes.sql` in the Supabase SQL editor.
2. Set `LSE_API_KEY` in GitHub Actions secrets **and** Render env group `orbis-equity-pipeline`.
3. Nightly/daily price ingest will prefer LSE daily candles for US names automatically.
4. Live ticks need an always-on worker (not Actions):

```bash
# local
export LSE_STREAM_SYMBOLS=AAPL,MSFT,NVDA
bash pipeline/scripts/run_live_stream.sh
```

On Render: blueprint service `orbis-equity-live-stream` (background worker — requires billing).
Writes latest ticks to `live_quotes`.

## 4. (Optional) Fix GitHub Actions too

Repo → Settings → Secrets and variables → Actions — add the same:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `LSE_API_KEY`
- `LSE_DATA_API_URL` (optional)

Nightly workflow has been failing because these were empty. Render can replace Actions; you do not need both.

---

## 5. Trust checklist after go-live

### A. Secrets must be real (not placeholders)

`https://example.supabase.co` / template JWT keys will make every ingest fail fast.
Set the same real values in:

1. **Vercel** → Project → Settings → Environment Variables  
2. **Render** → env group `orbis-equity-pipeline`  
3. **GitHub** → Settings → Secrets and variables → Actions (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`; `LSE_API_KEY` optional)

Then verify:

```bash
python -m pipeline.scripts.check_health
```

### B. Apply migrations, then bootstrap once

```sql
select count(*) from universe_members;
select max(date) from prices_daily;
select count(*), max(computed_at) from trend_radar;
select max(asof_date) from daily_brief;
```

Expect after bootstrap + one daily:

- hundreds of `universe_members`
- `prices_daily` max date ≈ last trading day
- `trend_radar` rows for names with enough history
- `daily_brief.asof_date` today/yesterday

### C. Trigger pipeline

1. Render → `orbis-equity-bootstrap` → **Manual Trigger** (required once)
2. Render → `orbis-equity-daily` → Manual Trigger (or wait for weekday cron)
3. Optional: GitHub Actions → "Orbis Equity Nightly Pipeline" → Run workflow

Daily now also runs cash EOD + desk modules (skew, ORB, analysis, quantropy, bias, perps, rotation, factors). Soft-fail keeps radar/brief alive if one desk module errors.

In the live site, `DataHonestyBar` should show a real **DATA AS OF** date (not `—`) and not STALE after a weekday run.

---

## 6. Local smoke (optional)

```bash
cp .env.example .env.local   # fill values
npm i && npm run build && npm start

# pipeline
pip install -r pipeline/requirements.txt
set -a; source .env.local; set +a
python -m pipeline.scripts.check_health
bash pipeline/scripts/run_bootstrap.sh
bash pipeline/scripts/run_daily.sh
```

---

## Architecture reminder

| Layer | Host | Role |
|-------|------|------|
| UI + `/api/*` | Vercel | Read Supabase, serve terminal |
| Ingest/compute | Render Cron | Write Supabase on schedule |
| DB | Supabase | Source of truth |

Do **not** run the heavy Python pipeline inside Vercel serverless — use Render (or Actions) for that.
