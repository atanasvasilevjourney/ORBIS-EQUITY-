# Phase 2 progress

## Shipped in `cursor/larger-phase2-5ca5`

- **`pipeline/strategies/`** — `Signal` type, `CostModel`, `execution.equal_weight_portfolio_return` (t−1 signal, next-open entry, turnover costs), `donchian_vwap.signals`, registry.
- **`strategy_signals` table** — migration `030_strategy_signals.sql`; nightly `pipeline.jobs.run_strategies --strategy donchian_vwap`.
- **`universe_member_snapshots`** — migration `031_universe_snapshots.sql`; written on each `us_index_universe` sync; research helper `pit_universe.load_universe_symbols_as_of`.
- **PIT fundamentals** — F-Score and factor extras filter FY reports by `filing_date <= as_of`; third balance year for prior ROA / asset-turnover deltas.
- **Backtests** — `loop_backtest`, `donchian_vwap_backtest`, `screener_backtest`, and `backtest_top_green_weekly` use shared execution economics.
- **Yahoo routes** — in-memory cache (`yahooCache.ts`) and per-IP rate limits on `/api/chart` and `/api/symbols/search`.

## Still open

- Wire desk APIs to read `strategy_signals` (retire lite desk **signals** per 2f).
- LOOP `portfolio_loop` next-open fills and explicit cost rows on `paper_orders`.
- Historical index membership before first snapshot date (true survivorship-free backtests).
- Login/session auth in front of `/api` (replace `Sec-Fetch-Site` gate).
