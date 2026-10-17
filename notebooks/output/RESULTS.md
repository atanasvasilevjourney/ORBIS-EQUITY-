# Zarattini ORB — Orbis LIQUID universe

Period: **60d** · Symbols: **30**

| Scenario | Trades | Net PnL | Final equity | Win % | Sharpe | Max DD |
|---|---:|---:|---:|---:|---:|---:|
| `no_slippage` | 1788 | $18,301 | $768,301 | 33.8% | 2.14 | -1.8% |
| `slippage_2c` | 1789 | $-21,932 | $728,068 | 33.8% | -1.68 | -4.0% |
| `slippage_2c_qqq_confirm` | 1047 | $-23,517 | $726,483 | 33.2% | -1.88 | -3.9% |

Paper research — not investment advice.

Regenerate: `PYTHONPATH=. python3 -m pipeline.research.run_zarattini_orb_validation`