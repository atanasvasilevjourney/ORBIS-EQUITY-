# KovaView Swing Strategy

EOD equity swing stack. Highest leverage first: relative strength and regime
gates beat entry polish. Parameter constants are **global** and promoted only
after neighborhood stability scoring (KAMA-DF method) — never via per-ticker
nightly Optuna.

## Stack layers

| Layer | Job | Current implementation |
|-------|-----|------------------------|
| Regime | Trade with structure | Dual-KAMA (`kama_regime`) soft gate; EWMAC trend |
| Momentum | Move has legs | `z_mom`, `f_ewmac` |
| Volatility | Risk governor | ATR used in breakout compression (ATR sizing TBD) |
| Relative strength | Rank vs universe | **Not yet** — highest priority gap |
| Entry | Timing | ATR compression breakout + volume confirm |

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
- Contributes up to 14 points of `quality_rank`
- GREEN requires non-bearish KAMA (`kama_regime >= 0`)

Defaults (`KAMA_SHORT_N=10`, `KAMA_LONG_N=30`, fast=2, slow=30) are fixed
production constants. Change them only after stability promotion.

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

## What we explicitly skip

- Per-ticker Optuna in production
- Blended CCI/RSI/Fisher pane oscillators as ranking inputs
- Cycle-adaptive StochRSI at universe scale
