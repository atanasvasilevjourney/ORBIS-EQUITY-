# Phase 1 — remainder (deferred layer)

Phase 1 **core** shipped in PR #50 (freshness gate, `/status`, `pipeline_runs` recorder for prices/watchlist/loop, DataHonestyBar).  
**Intentionally not done** — finish when ops bandwidth allows, without blocking Phase 2.

## Ops (one-time)

- [ ] Apply **`supabase/migrations/024_pipeline_runs.sql`** in Supabase SQL editor.

## Pipeline / reliability

- [ ] Wire **`pipeline_runs`** on all nightly compute modules (rotate, perps, quantropy, bias, skew, ORB, aggregates, f_score, factor_scores, opening_range, stock_analysis).
- [ ] Investigate **LOOP engine** not advancing `paper_loop_runs.asof_date` after 2026-09-28 reset (Render/GitHub `compute.portfolio_loop`).
- [ ] **Price contract:** always write `adj_close` on ingest; compute uses adjusted series consistently.
- [ ] Per-source **health** row on `/status` (last success/fail counts from `pipeline_runs`).

## Web / freshness

- [ ] Freshness gate on **rotate, orb, bias, skew, quantropy** APIs (loop/analysis/perps/summary done).
- [ ] When stale: **disable `liteDeskApi` / `liteDesks`** recompute; serve last DB snapshot only with `asOf` + stale flag.
- [ ] SSR **last good snapshot** on cockpit modules that still show empty dashes.

## Tests

- [ ] E2E smoke for `/status` and stale banner when `asOf` is backdated in fixture (optional).

## Rollback

All Phase 1 remainder items are additive; reverting individual PRs does not require dropping `pipeline_runs`.
