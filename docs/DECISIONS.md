# EMA200 scanner — implementation decisions

## Module layout

- **Spec path:** `orbis_equity/ema200_scanner/`
- **Implemented at:** `pipeline/ema200_scanner/` to match existing Orbis Python pipeline layout (`pipeline/ingest`, `pipeline/compute`, `pipeline/tests`).

## Data vendors (Phase 1)

- **Equity EOD backfill:** Reuses `pipeline.clients.cash_eod` (Yahoo chart → Stooq fallback) behind `pipeline/ema200_scanner/data/vendors/yahoo.py` instead of a new Polygon/Tiingo adapter. Primary store remains Supabase `prices_daily`.
- **Crypto:** `ccxt` + Binance daily candles; universe pairs stored as `BTC-USDT` in Postgres, resolved to `BTC/USDT` at fetch time.

## Indicators

- **EMA200:** Pine Script `ta.ema` seeding (SMA over first `period` bars, then recursive EMA). Values before `history_min_bars` (200) are forced to NaN. The nightly job warms that EMA on `nightly.ema_warmup_bars` (1260) so the published value is not the SMA seed.
- **ATR14:** Reuses `pipeline.compute.atr_risk.compute_atr` (SMA of true range). This may differ slightly from TradingView’s Wilder RMA ATR; Phase 1 acceptance targets **EMA** reference validation, not ATR parity.
- **Adjusted prices:** Open, high, low, and close are scaled by `adj_close / close` before any EMA or ATR math (`pipeline/ema200_scanner/data/adjust.py`). Adjusting only the close leaves the high-line EMA and the ribbon on raw prints and mis-tags touches after splits.

## TradingView validation

- Unit tests cover Pine EMA seeding deterministically.
- Live checks for five reference symbols run only when `RUN_EMA200_TV_TESTS=1` (CI stays offline-safe). Record manual TradingView spot checks in this file when run.

## Phase scope

- **Phase 1:** Universe, vendors, indicators, nightly job, schema.
- **Phase 2 (research):** `pipeline/research/ema200_backtest.py` + notebook `pipeline/research/notebooks/ema200_touch_is_oos_validation.ipynb`.

### Phase 2 gate (2019-01-01 → present, adjusted daily)

Initial run on AMZN, SPY, AAPL, QQQ, NVDA:

- **EMA200 is not clearly special vs EMA150/250** on 5d forward returns (e.g. AMZN: EMA200 −0.10% vs EMA250 +0.75% mean 5d).
- **Touch events underperform regime-matched random** 5d entries on several names (e.g. AMZN, SPY).
- **Long simulation** OOS Sharpe negative on AMZN/SPY vs positive buy-and-hold; Monte Carlo p95 of mean trade return still < 0 on AMZN.

**Action:** `mode` set to `watchlist_only` in YAML until a broader universe event study (incl. delisted) or intraday confirmation changes the verdict. Do not ship Discord “signal” alerts until user approves.

Manual TradingView spot-check on 15m/1m remains optional; Phase 3 uses **5m bar close vs the daily EMA200 ribbon stepped onto intraday bars** (not a native 200×5m EMA).

### Phase 3 (intraday confirmation — enabled)

- **Anchor:** Daily adjusted double EMA200 ribbon forward-filled onto each 5m bar (`attach_daily_ema200_step` / `mergeDailyRibbonOn5m`). Same definition as the EOD watchlist, not Yahoo’s intraday EMA200.
- **Universe:** Names on the daily watchlist (`RETRACE_HELD` / desk scan) unless `require_daily_watchlist` is turned off in YAML.
- **Triggers (detect/log only):** `INTRADAY_AT_RIBBON` (within `shortlist_atr`, close ≥ daily EMA200, optional 5m rvol confirm) and `INTRADAY_RECLAIM` (dip/re-extend + reclaim; **requires EOD `RETRACE_HELD`**).
- **Data:** Yahoo 5m (~5d, delayed). Drop the in-progress session bar before 16:00 ET.
- **Jobs:** `python -m pipeline.ema200_scanner.jobs.intraday` during RTH; terminal `GET /api/ema200/intraday` and 5m chart overlay via `GET /api/chart/[ticker]?interval=5m`.
- **Phase 4** (Discord/email alerts) remains blocked until explicit user approval.

## Phase scope (alerts)

- **Phase 4+** (alerts, journal) blocked until signal mode approval.

## Discretionary watchlist UI

- **`mode: watchlist_only`** — terminal shows retracements at `/ema200` and `GET /api/ema200`; no “take this trade” copy.
- Default filter: within `shortlist_atr` of EMA200, prior uptrend (`days_above`, slope), **close ≥ EMA200** (held the level).
- Optional `?near=1` relaxes trend/hold rules for broader “near EMA” browsing.
- Populated by nightly `pipeline.ema200_scanner.jobs.nightly` → `ema200_features`.
- **Universe:** `universe.equities: sp500_ndx100` — merged S&P 500 + Nasdaq-100 (~600 names) via Wikipedia + Nasdaq API; crypto off by default.
- **UI filter:** API returns only `RETRACE_HELD` (retrace + close ≥ EMA200 + rising trend), not every name near the line.
