# Phase 1 — remainder

Phase 1 **core** shipped in PR #50. This doc tracks the deferred layer.

## Ops (one-time)

- [x] Apply **`supabase/migrations/024_pipeline_runs.sql`** in Supabase SQL editor.

## Pipeline / reliability

- [x] Wire **`pipeline_runs`** on nightly compute modules (via `run_recorded` / existing recorders).
- [x] **LOOP engine:** `portfolio_loop` missing `if __name__ == "__main__"` prevented nightly runs — fixed.
- [x] **Price contract:** always write `adj_close` on ingest; compute uses adjusted series consistently (`price_series` helper).
- [x] Per-source rows on `/status` from `pipeline_runs` (grows as jobs run).

## Web / freshness

- [x] Freshness gate on **rotate, orb, bias, skew, quantropy** APIs.
- [x] When stale: block **lite desk** recompute on rotate/quantropy empty snapshots.
- [x] Cockpit **desk summaries** on `/api/dashboard` (`desks`) — module tiles populate on first load without expanding desks.

## Ops (DB)

- [x] Apply **`supabase/migrations/025_fundamental_analysis_columns.sql`** (fundamental_summary / verdict columns).

## Tests

- [x] Entrypoint regression for `portfolio_loop` CLI.
- [x] `price_series` unit tests.

---

**Next:** strategy platform — see [`PHASE2_PLAN.md`](./PHASE2_PLAN.md).
