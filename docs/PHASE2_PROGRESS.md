# Phase 2 progress

## Shipped in `cursor/larger-phase2-5ca5`

- **`pipeline/strategies/`** — `Signal` type, `CostModel`, `execution.equal_weight_portfolio_return` (t−1 signal, next-open entry, turnover costs), `donchian_vwap.signals`, registry.
- **`strategy_signals` table** — migration `030_strategy_signals.sql`; nightly `pipeline.jobs.run_strategies --strategy donchian_vwap`.
- **`universe_member_snapshots`** — migration `031_universe_snapshots.sql`; written on each `us_index_universe` sync; research helper `pit_universe.load_universe_symbols_as_of`.
- **PIT fundamentals** — F-Score and factor extras filter FY reports by `filing_date <= as_of`; third balance year for prior ROA / asset-turnover deltas.
- **Backtests** — `loop_backtest`, `donchian_vwap_backtest`, `screener_backtest`, and `backtest_top_green_weekly` use shared execution economics.
- **Yahoo routes** — in-memory cache (`yahooCache.ts`) and per-IP rate limits on `/api/chart` and `/api/symbols/search`.

## Shipped (follow-up)

- **`watchlist_momentum`** strategy + nightly `--all` publish (after trend radar, before LOOP).
- **`/api/screener`** uses `watchlist_momentum` BUY rows when present (falls back to `trend_radar` filters).
- **`/api/loop`** exposes `strategy.donchianVwap` entry candidates / exit hints from `strategy_signals`.
- LOOP UI shows **Donchian entry candidates** table.

## Shipped (`cursor/loop-paper-economics-5ca5`)

- **`portfolio_loop`** reads `donchian_vwap` BUY rows from `strategy_signals` (falls back to inline prior-bar if bus empty).
- **Paper economics** — migration `032_paper_order_costs.sql`; orders store `fill_price`, `fill_mode`, commission/slippage/`cost_usd` (5+5 bps/side); BUY entries prefer next-session open when on tape.
- **Rotate / Quantropy APIs** no longer recompute lite desk **signals** when pipeline snapshots are missing (empty + headline only).

## Shipped (research gate)

- **`backtest_top_green_weekly`** optional `require_regime` (SPY `buys_allowed` on signal day).
- **CI smoke** — `pipeline/tests/test_donchian_vwap_backtest_smoke.py`, `test_backtest_regime_gate.py`; runner `python -m pipeline.jobs.loop_research_gate`.

## Still open
- Historical index membership before first snapshot date (true survivorship-free backtests).
- Login/session auth in front of `/api` (replace `Sec-Fetch-Site` gate).
- `portfolio_loop_xs` production harness (LOOP v2 cross-sectional sleeve).
