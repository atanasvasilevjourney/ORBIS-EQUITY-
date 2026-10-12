# ORBIS Equity — EMA200 Touch Scanner (Agent Spec)

Persistent agent context for the EMA200 touch scanner. **Phase 1 is implemented under `pipeline/ema200_scanner/`** (see `docs/DECISIONS.md` for layout deviations).

## Rules for agents

1. Work in phases (below). Do not start a phase until the previous phase's acceptance criteria pass.
2. Deterministic, vectorized, testable code. No hidden state, no global mutable config.
3. All thresholds live in `pipeline/ema200_scanner/config/ema200_scanner.yaml`. Never hardcode them.
4. Never place orders. Detect, score, log, and alert only.
5. Never use unadjusted prices. Never use future data (no lookahead).
6. Every external call needs timeout, retry with backoff, and structured logging.
7. If this spec conflicts with the ORBIS repo, follow repo conventions and note in `docs/DECISIONS.md`.
8. Write tests alongside code. A phase is not done without passing tests.

## Build phases

| Phase | Scope | Gate |
|-------|--------|------|
| **1** | Universe, vendors, adjusted prices, nightly features | EMA200 vs reference symbols; EMA/ATR unit tests; features table |
| **2** | Event study + baselines (EMA150/250, random days) | **Hard gate** — no signal mode without edge |
| **3** | Shortlist + intraday trigger | Batch vs replay parity |
| **4** | Alerts + state machine | Idempotency, cooldown, Discord/email staging |
| **5** | Journal + monitoring | Heartbeat on missed jobs |

## Config

See `pipeline/ema200_scanner/config/ema200_scanner.yaml` (source of truth).

## Database

Migration `supabase/migrations/021_ema200_scanner.sql` defines `ema200_universe`, `ema200_features`, and forward-looking tables for later phases.

## Phase 1 runbook

```bash
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
cd pipeline && ../.venv/bin/python -m pytest tests/test_ema200_*.py -m "not integration"

# After Supabase migration + env (SUPABASE_URL, SUPABASE_SERVICE_KEY):
PYTHONPATH=/workspace .venv/bin/python -m pipeline.ema200_scanner.jobs.nightly
```

Optional live EMA checks (yfinance-adjusted proxy):

```bash
RUN_EMA200_TV_TESTS=1 ../.venv/bin/python -m pytest tests/test_ema200_tradingview.py -m integration
```

Full narrative spec (signal definition, alert payload, schema SQL, risks) matches the agent brief used to bootstrap this module; extend this file if the product owner publishes an updated canonical copy.
