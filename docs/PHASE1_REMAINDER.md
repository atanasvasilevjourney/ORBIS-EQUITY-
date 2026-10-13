# Phase 1 — remainder

Phase 1 **core** shipped in PR #50. This doc tracks the deferred layer.

## Ops (one-time)

- [x] Apply **`supabase/migrations/024_pipeline_runs.sql`** in Supabase SQL editor.

## Pipeline / reliability

- [x] Wire **`pipeline_runs`** on nightly compute modules (via `run_recorded` / existing recorders).
- [x] **LOOP engine:** `portfolio_loop` missing `if __name__ == "__main__"` prevented nightly runs — fixed.
- [ ] **Price contract:** always write `adj_close` on ingest; compute uses adjusted series consistently.
- [x] Per-source rows on `/status` from `pipeline_runs` (grows as jobs run).

## Web / freshness

- [x] Freshness gate on **rotate, orb, bias, skew, quantropy** APIs.
- [x] When stale: block **lite desk** recompute on rotate/quantropy empty snapshots.
- [ ] SSR **last good snapshot** on cockpit modules that still show empty dashes.

## Tests

- [x] Entrypoint regression for `portfolio_loop` CLI.
