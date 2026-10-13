# Phase 2 — Strategy architecture (plan)

**Scope:** One signal interface, point-in-time storage, shared costs/sizing, UI reads DB only.  
**Explicitly out of scope:** Phase 1 remainder (see `docs/PHASE1_REMAINDER.md`), new alpha strategies (Phase 4), backtest CI (Phase 3).

---

## Goals

1. **`signals(universe, as_of, params) -> Signal[]`** as pure functions under `pipeline/strategies/`.
2. **Append-only, point-in-time** persistence: every row has `as_of` (signal date) and `known_on` (when the signal could first be known — typically EOD after ingest).
3. **Single execution path:** nightly pipeline computes → writes `strategy_signals` → Next.js APIs **read only** (retire client-side `liteDesks` for production desks).
4. **Shared economics:** `pipeline/strategies/costs.py` (commission, spread, slippage) + `pipeline/strategies/sizing.py` (Carver vol-target helper) used by loop/backtests later.

---

## Target architecture

```text
prices_daily (+ PIT fundamentals later)
        │
        ▼
pipeline/strategies/*.py   (pure, no Supabase)
        │
        ▼
pipeline/jobs/run_strategies.py  (or extend compute.* to call strategies + write)
        │
        ▼
strategy_signals (append-only)
strategy_runs    (optional mirror of pipeline_runs per strategy batch)
        │
        ▼
src/app/api/*    (SELECT latest as_of WHERE known_on <= as_of; no lite recompute when row exists)
```

---

## PR sequence (one concern each)

| # | PR | Contents |
|---|-----|----------|
| **2a** | Core interface + schema | `Signal` type, `BaseStrategy` protocol, migration `025_strategy_signals.sql`, `run_strategies` smoke test |
| **2b** | Donchian/VWAP (LOOP) | Move rules from `donchian_vwap.py` into `strategies/donchian_vwap.py`; `portfolio_loop` reads ranked signals or writes same book from strategy output |
| **2c** | TEMA/Carver (CASH) | Consolidate `perps_math` entrypoints behind strategy module; deprecate duplicate paths in TS for **book** (keep `tema.ts` for chart viz only) |
| **2d** | Watchlist (module 1) | `strategies/watchlist_momentum.py` from `trend_radar.process_ticker` |
| **2e** | PIT fundamentals prep | `fundamentals_as_of` table or `known_on` on factor snapshots; gate `factor_scores` / F-Score (no restated snapshot in backtest) |
| **2f** | Remove lite desk signals | `liteDeskApi` → chart-only or delete; rotate/quant APIs return stale empty + last snapshot |

Recommend starting **2a + 2b** (LOOP is well-tested and paper-only).

---

## Files to create / change (first PR: 2a)

| Action | Path |
|--------|------|
| **Create** | `pipeline/strategies/__init__.py` |
| **Create** | `pipeline/strategies/types.py` — `Signal`, `Side`, params dataclasses |
| **Create** | `pipeline/strategies/registry.py` — name → callable registry |
| **Create** | `pipeline/strategies/costs.py` — stub with defaults matching loop paper |
| **Create** | `pipeline/strategies/sizing.py` — vol-target stub |
| **Create** | `pipeline/jobs/run_strategies.py` — CLI: run one strategy, append rows |
| **Create** | `supabase/migrations/025_strategy_signals.sql` |
| **Create** | `pipeline/tests/test_strategy_signals.py` |
| **Touch** | `README.md` — migration 025 |
| **Touch** | `.github/workflows/nightly-pipeline.yml` — optional later step after 2b |

### Migration sketch (`025_strategy_signals.sql`)

- `strategy_signals`: `(strategy_id, symbol, as_of, known_on, side, score, stop, size_hint, reason, params_hash, created_at)`  
- **PK:** `(strategy_id, symbol, as_of, known_on)` or surrogate `id` + unique index.  
- **RLS:** anon read, service write (match existing desks).

---

## Interface (Python)

```python
@dataclass(frozen=True)
class Signal:
    symbol: str
    side: Literal["BUY", "SELL", "FLAT"]
    score: float
    stop: float | None
    size_hint: float | None
    reason: str

def signals(
    universe: Sequence[str],
    bars: Mapping[str, pd.DataFrame],  # symbol -> OHLCV indexed by date
    as_of: date,
    params: Mapping[str, Any],
) -> list[Signal]: ...
```

- **No look-ahead:** functions only use rows with `index <= as_of`.
- **`known_on`:** set to `as_of` for EOD strategies; fundamentals later use `min(as_of, filing_date)`.

---

## Tests (2a)

- Unit: synthetic bars, assert no signal uses future bar.
- Unit: registry dispatches by `strategy_id`.
- Integration (mock Supabase): `run_strategies` appends rows, second run same day idempotent or append-only per design.
- Existing **`donchian_vwap` / `loop` tests** must pass after 2b migration.

**Run:**

```bash
python -m pytest pipeline/tests/test_strategy_signals.py pipeline/tests/test_donchian_vwap.py -v
npm test
```

---

## UI / API rules (Phase 2)

- Desk routes load **`strategy_signals`** (or existing desk tables fed *only* from strategies) with:
  - `known_on <= client_as_of` (default: latest `prices_daily` date).
- If no row: show **last snapshot** + stale banner — **never** silently run `liteRotatePayload` / `liteQuantPayload` for signals.
- Chart components may still use `src/lib/tema.ts` for ribbons (display math ≠ book signals).

---

## Risks

| Risk | Mitigation |
|------|------------|
| Big-bang migration breaks LOOP | 2b keeps `portfolio_loop` harness; parallel run vs old logic until diff tests green |
| Duplicate TEMA/Carver drift | 2c single Python source; TS tests only for chart |
| PIT fundamentals hard | 2e separate PR; block factor-gated strategies until done |
| Table growth (append-only) | Partition by `as_of` month or retention job in Phase 3 |

---

## Rollback

- **2a:** Drop `strategy_signals` table; remove job from workflow; no UI dependency until 2f.
- **2b:** Revert to inline `donchian_vwap` in `portfolio_loop` (keep pure functions in `donchian_vwap.py`).
- **2f:** Re-enable lite desk behind env `ALLOW_LITE_DESK=1` if needed for demos.

---

## Success criteria

- [ ] At least **LOOP** and **watchlist** produced only via `pipeline/strategies/*` + DB.
- [ ] API responses include `strategyId`, `asOf`, `knownOn` on each signal row.
- [ ] No production code path computes rotate/quant **signals** in TypeScript.
- [ ] Documented cost/sizing modules ready for Phase 3 backtest import.

---

## Approval to implement

Reply **“build 2a”** (schema + interface only) or **“build 2a+2b”** (include LOOP migration). Phase 1 remainder stays in `docs/PHASE1_REMAINDER.md` until picked up separately.
