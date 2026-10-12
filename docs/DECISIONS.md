# EMA200 scanner — implementation decisions

## Module layout

- **Spec path:** `orbis_equity/ema200_scanner/`
- **Implemented at:** `pipeline/ema200_scanner/` to match existing Orbis Python pipeline layout (`pipeline/ingest`, `pipeline/compute`, `pipeline/tests`).

## Data vendors (Phase 1)

- **Equity EOD backfill:** Reuses `pipeline.clients.cash_eod` (Yahoo chart → Stooq fallback) behind `pipeline/ema200_scanner/data/vendors/yahoo.py` instead of a new Polygon/Tiingo adapter. Primary store remains Supabase `prices_daily`.
- **Crypto:** `ccxt` + Binance daily candles; universe pairs stored as `BTC-USDT` in Postgres, resolved to `BTC/USDT` at fetch time.

## Indicators

- **EMA200:** Pine Script `ta.ema` seeding (SMA over first `period` bars, then recursive EMA). Values before `history_min_bars` (500) are forced to NaN.
- **ATR14:** Reuses `pipeline.compute.atr_risk.compute_atr` (SMA of true range). This may differ slightly from TradingView’s Wilder RMA ATR; Phase 1 acceptance targets **EMA** reference validation, not ATR parity.
- **Adjusted prices:** Feature math uses `adj_close` when present in `prices_daily`, else `close`. Vendor backfill uses adjusted close from Yahoo/Stooq.

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

Manual TradingView spot-check on 15m/1m remains out of scope for this daily harness (Phase 3).

## Phase scope (alerts)

- Phases 3–5 (intraday, alerts, journal) blocked until signal mode approval.

## Discretionary watchlist UI

- **`mode: watchlist_only`** — terminal shows retracements at `/ema200` and `GET /api/ema200`; no “take this trade” copy.
- Default filter: within `shortlist_atr` of EMA200, prior uptrend (`days_above`, slope), **close ≥ EMA200** (held the level).
- Optional `?near=1` relaxes trend/hold rules for broader “near EMA” browsing.
- Populated by nightly `pipeline.ema200_scanner.jobs.nightly` → `ema200_features`.
- **Universe:** `universe.equities: sp500_ndx100` — merged S&P 500 + Nasdaq-100 (~600 names) via Wikipedia + Nasdaq API; crypto off by default.
- **UI filter:** API returns only `RETRACE_HELD` (retrace + close ≥ EMA200 + rising trend), not every name near the line.
