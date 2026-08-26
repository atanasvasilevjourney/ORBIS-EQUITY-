# KovaView Swing Strategy

EOD equity swing stack. Highest leverage first: relative strength and regime
gates beat entry polish. Parameter constants are **global** and promoted only
after neighborhood stability scoring (KAMA-DF method) — never via per-ticker
nightly Optuna.

## Stack layers

| Layer | Job | Current implementation |
|-------|-----|------------------------|
| Regime | Trade with structure | **Market:** SPY SMA200 + vol pctl (`market_regime`); **Ticker:** dual-KAMA + EWMAC + **ADX** |
| Momentum | Move has legs | `z_mom`, `f_ewmac` |
| Vol / risk | Risk governor | **ATR×2.5 stop + 1.25% equity risk sizing** (`atr_risk`) |
| Relative strength | Rank vs universe | **Not yet** — highest priority gap |
| Entry | Timing | ATR compression breakout + volume; **too_late / wait_pullback** vetoes |
| Exit | Hold winners | Prefer **SMA20 wide trail** (+ BE@+3%, 2-loss cooldown); else exit-on-RED |

## Dual-KAMA regime

`pipeline/compute/kama_regime.py` computes Kaufman Adaptive MAs.

- **Production regime (`kama_regime`)**: prior close vs long KAMA — bullish when
  price is above the adaptive long MA (prior bar, no lookahead).
- **Research position (`dual_kama_position`)**: short KAMA > long KAMA, used
  inside the stability grid / Sharpe evaluation.

Why not raw short/long cross in production? Under high efficiency ratio both
KAMAs converge; a floating-point cross is brittle. Price vs long KAMA is the
stable regime gate.

- Feeds `trend_radar.kama_regime` (`1` / `-1` / `0`)
- Contributes up to 12 points of `quality_rank`
- GREEN requires non-bearish KAMA (`kama_regime >= 0`)

Defaults (`KAMA_SHORT_N=10`, `KAMA_LONG_N=30`, fast=2, slow=30) are fixed
production constants. Change them only after stability promotion.

## ADX trend-strength gate (from swing-screener)

`pipeline/compute/adx.py` — Wilder ADX(14) + DI+/DI−:

- Up to **8** quality_rank points when ADX ≥ 25 and DI+ > DI−
- GREEN requires `adx_ok` (ADX ≥ 20 and DI+ > DI−)
- Counts toward convergence (`/7`)

## Entry timing vetoes (from swing-screener)

`pipeline/compute/entry_timing.py`:

| Label | Rule (examples) | Effect |
|-------|-----------------|--------|
| `too_late` | >50% runup from 50d low, >12% above MA20, RSI+Stoch exhaustion | Demotes GREEN → GREY; alert journal skips |
| `wait_pullback` | >30% runup, >6% above MA20, RSI/Stoch overbought | Advisory badge; optional skip flag |
| `ok` | None of the above | Normal |

Stored on `trend_radar.entry_timing`.

## Market regime gate (from River)

`pipeline/compute/market_regime.py` — SPY-level hard gate for new buys:

- `trend_regime`: bull if SPY ≥ SMA200, else bear
- `vol_regime`: risk_off if realized-vol percentile > 75, else risk_on
- `buys_allowed`: bull **and** risk_on

Alert entries should call `apply_regime_filter("buy", regime)` / skip when
`buys_allowed` is false. Sells always pass.

## ATR risk sizing (from River)

`pipeline/compute/atr_risk.py`:

- `stop_distance = ATR(14) × 2.5`
- `shares = floor(equity × 1.25% / stop_distance)`, capped by buying power
- Long stop: `entry − stop_distance`

Wired into the radar alert trade journal (stop, shares, optional ATR-stop exit).

## SMA20 wide trail + cooldown (from Edge-Swing v3.2)

`pipeline/compute/trail_exit.py`:

- Initial stop = ATR plan stop
- At **+3%**: move stop to breakeven
- Trail: `max(peak × (1 − 7%), SMA20)`; after **+10%** profit, trail **SMA20 only**
- **2 consecutive losses** → skip the next entry (cooldown)

Default alert backtest exit mode is `sma20_trail` (tight % trails intentionally avoided).

## Parameter stability (KAMA-DF)

`pipeline/compute/param_stability.py` implements the promotion gate:

1. Evaluate a grid/trial set → in-sample and out-of-sample Sharpe each.
2. Qualify candidates with **IS Sharpe > 1.0**.
3. Among qualified, pick the set with the **lowest OOS Sharpe std** across its
   nearest neighbors in normalized parameter space.
4. Freeze that set as module constants (Trend Radar / KAMA). Do not optimize
   per symbol in the nightly pipeline.

```python
from pipeline.compute.param_stability import score_candidates, evaluate_param_grid
from pipeline.compute.kama_regime import strategy_returns_for_params
from pipeline.compute.param_stability import annualized_sharpe

def eval_fn(params):
    is_r = strategy_returns_for_params(train_close, params)
    oos_r = strategy_returns_for_params(test_close, params)
    return annualized_sharpe(is_r), annualized_sharpe(oos_r)

selection = evaluate_param_grid(param_dicts, eval_fn)
# selection.best.params → promote to kama_regime defaults
```

Apply the same gate when retuning `EWMAC_FAST` / `EWMAC_SLOW`.

## IS / OOS validation harness

```bash
PYTHONPATH=/workspace python -m pipeline.research.kama_backtest \
  --tickers SPY,QQQ,IWM,AAPL,MSFT,XOM,JPM \
  --start 2018-01-01 \
  --out pipeline/research/artifacts/kama_oos_validation.json
```

Latest run (train 2018-01 → 2023-03, test 2023-03 → 2026-08):

| Strategy (OOS Sharpe, equal-weight) | Mean | Median |
|-------------------------------------|------|--------|
| Buy & hold | 1.08 | 0.94 |
| Production regime (close > long KAMA) | **0.85** | **0.96** |
| Production dual-KAMA cross | 0.73 | 0.67 |
| Stability-selected regime | 0.71 | 0.67 |
| Stability-selected cross | 0.21 | 0.18 |

Takeaways:
- **Production regime beats the raw cross** on OOS — keep price-vs-long-KAMA as the gate.
- **Stability-selected crosses overfit IS** and degrade OOS; do not auto-promote per-ticker winners.
- OOS window is a strong equity bull; buyhold leads — KAMA is a risk/regime filter, not an alpha engine alone.
- Re-run the harness before changing production KAMA constants.

## Radar alert trade backtest

Entries mirror terminal alerts (GREEN_FLIP / breakout). Fills next open; no lookahead.

```bash
PYTHONPATH=/workspace python -m pipeline.research.radar_alert_backtest \
  --tickers SPY,AAPL,MSFT,JPM,XOM \
  --from-date 2023-01-01 --min-rank 60 --min-convergence 4 \
  --exit-mode sma20_trail --require-regime --skip-too-late --cooldown \
  --max-trades 12
```

Gates: SPY buys_allowed; too_late veto; ATR stop + 1.25% risk sizing; optional wait_pullback skip.

Latest qualified sample (2023→2026, rank≥60, conv≥4):

| Setup | Trades | Win rate | Avg ret | Median | Avg hold |
|-------|--------|----------|---------|--------|----------|
| Leave GREEN (no regime/ATR) | 90 | 33% | +0.15% | −0.74% | 12d |
| Until RED (no regime/ATR) | 42 | 55% | +2.38% | +2.84% | 50d |
| Until RED + **regime gate + ATR stop** | **37** | **49%** | **+1.63%** | −0.69% | **41d** |
| **sma20_trail + timing + cooldown** | *(re-run after this PR)* | | | | |

Takeaway: gate new risk with SPY regime + ADX + too_late; size with ATR; prefer wide SMA20 trail (or exit-on-RED) over exit-on-GREY.

## What we explicitly skip

- Per-ticker Optuna in production
- Blended CCI/RSI/Fisher pane oscillators as ranking inputs
- Cycle-adaptive StochRSI at universe scale
- Tight / tiered %-profit trails (Edge-Swing v2/v3.1 failure mode)
- IDX RL ensemble / LLM narrative layers from peer screeners
