# ORBIS EQUITY architecture

Paper research terminal. Nothing here sends a live broker order.

## Layers

```text
Vendors (Yahoo, Stooq, Wikipedia, Nasdaq, filings, GDELT)
        │
        ▼
pipeline/ingest          universe, prices, fundamentals, reports, earnings, news
        │  writes prices_daily, universe_members, universe_member_snapshots
        ▼
pipeline/compute         trend radar, factors, F-score, desks
pipeline/strategies      pure signals(universe, bars, as_of) → strategy_signals
        │
        ▼
Supabase                 append-only signals, paper books, pipeline_runs
        │
        ▼
src/app/api              read models. Stale tapes suppress actionable orders.
        │
        ▼
Desks                    cockpit, LOOP, rotate, quantropy, and the research sleeves
```

Nightly order is `.github/workflows/nightly-pipeline.yml`: universe and prices, then trend radar, `run_strategies --all`, the XS watchlist sleeve, the Donchian LOOP book, then the other desks.

## Two equity books

| Book | Engine | What it trades on paper |
|------|--------|-------------------------|
| Donchian LOOP | `pipeline.compute.portfolio_loop` | Close above the prior 55-day Donchian high and 20-day VWAP. Equal weight, sector caps. |
| XS watchlist | `pipeline.compute.portfolio_loop_xs` | Sector-residual 63-session strength when coverage is at least 80%. A +4% day breaks ties. Wide trail or 5-session rebalance. SPY regime gate. |

They write different tables (`paper_*` vs `paper_*_xs`). The XS sleeve does not resize the Donchian book.

## Data rules

- Signal math uses adjusted close (`pipeline/utils/price_series.py`).
- Strategy functions only see bars on or before `as_of`. `known_on` is when the row could first be known.
- Universe membership for research prefers `universe_member_snapshots` on or before `as_of` (`pipeline/research/pit_universe.py`). A missing snapshot falls back to the live index and logs survivorship bias.
- Pharma and biotech names are not LOOP-tradable.

## Version control for schema

Migrations live in `supabase/migrations/NNN_name.sql`.

- Do not rename a file that may already be applied.
- Do not reuse a numeric prefix. `pipeline/tests/test_migration_versions.py` fails CI on a new collision.
- Three prefixes already shipped twice (`006`, `007`, `021`). They are an allowlist, not a pattern to copy.

## CI

| Workflow | What it proves |
|----------|----------------|
| `.github/workflows/test.yml` | pytest (pipeline, including migration prefixes and relative strength) and Vitest |
| `.github/workflows/web-ci.yml` | `tsc`, lint, production build, Playwright smoke plus paper desks |

Both cancel an older run on the same ref when a new push arrives. The nightly workflow is the data job, not the test gate.

## What the API will not do

Desk routes read stored runs. When the tape is more than one NYSE session behind, actionable orders are masked. Rotate and Quantropy do not recompute a lite signal book on an empty snapshot.
