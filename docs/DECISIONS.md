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

- **This branch:** Phase 1 only (universe, vendors, indicators, nightly job, schema). Phases 2–5 intentionally not started.
