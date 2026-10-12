# LOOP v2 proposal (research · YTD 2026)

## Why v1 underperforms SPY in a trending year

1. **Exit churn:** With fixed stops removed, **100% of closes were `rank_decay` (rank &lt; 50)** while many names were still structurally GREEN. That cuts trend legs early.
2. **Stock-level portfolio, not cross-section:** LOOP fills up to 8 names on discrete rules and rotates often. In 2026, **leadership was concentrated** in a rising subset of large-cap tech/growth — a **ranked basket** captured that; single-name churn did not.
3. **No benchmark regime filter:** LOOP uses `daily_brief` posture; it does **not** gate on SPY SMA200 + vol risk-on (used successfully in alert backtests).
4. **Entry timing:** EOD close fills on breakout/vol signals often chase extended moves; research entries on **next open** after **EWMAC / KAMA** flips showed stronger per-trade edge in the matrix.

## Research results (2026-01-01 → 2026-09-26, ex-pharma universe)

| Approach | YTD return (approx.) | Notes |
|----------|----------------------|--------|
| **SPY** | **+13.8%** | Benchmark |
| **QQQ** | **+21.8%** | Benchmark |
| **LOOP v1 (no stop, rank decay exit)** | **+2.7%** | Production-like rules |
| **LOOP entries, exit RED only** | **−8.5%** | Holding losers too long without rank trim |
| **Top-8 GREEN weekly (full universe)** | **+68%*** | *Inflated — same-day signal/return overlap; use lag-1* |
| **Top-8 GREEN, 1-day lag, liquid 30** | **+29–37%** | Sanity-checked; beats SPY |
| **Best entry×exit pair (liquid sample)** | **EWMAC_CROSS_UP → kama_bear** | ~+4.4% avg/trade, 69% win |

Run: `python -m pipeline.research.loop_strategy_research`

## Recommended v2: “Trend Radar Cross-Sectional Sleeve”

**Objective:** Own the **strongest Trend Radar trends** in the index, rebalance mechanically, exit on **regime** not noise.

### Universe
Same as today: **S&P 500 ∪ Nasdaq-100**, **no pharma/biotech**.

### Regime gate (new entries only)
- SPY **≥ SMA200** and realized-vol percentile **≤ 75** (`market_regime.buys_allowed`).
- Optional: keep `posture ≥ 50` from `daily_brief`.

### Portfolio construction (weekly)
- **Signal date:** prior session close ( **t−1**, no lookahead).
- Eligible: `state == GREEN`, `quality_rank ≥ 60`, `z_mom > 0`, `f_ewmac > 0`.
- Rank by `quality_rank`, then `convergence`, then `f_ewmac`.
- Hold **top 8**, **equal weight** (~12.5% each), max **2 per sector**.
- **Rebalance** every **5 trading days** (or Monday weekly).

### Exits (position level)
- Drop from book if **no longer in top 8** at rebalance, OR
- **Hard exit:** `state == RED` or **KAMA bear flip** (same as `kama_bear` in matrix).
- **Do not** exit on rank &lt; 50 alone while still GREEN.

### Optional entry boost (replace late breakout chase)
- Prefer names with **EWMAC cross up** or **KAMA flip bull** in the last 5 sessions when filling empty slots.

### Sizing
- Equal weight removes Turtle/ATR complexity for v2; optional vol-scaling later.

### Expected behavior
- **Higher beta to QQQ** in bull regimes; **cash or reduced count** when regime gate off.
- Fewer round trips; longer holds in leaders.

## Implementation path

1. Add `pipeline/compute/portfolio_loop_xs.py` (cross-sectional weekly book) or refactor `portfolio_loop.py` with `mode=xs`.
2. Wire nightly job after `trend_radar` compute.
3. Backtest: fix `backtest_top_green_weekly` to **lag-1** and add regime gate; promote to CI smoke.

Not investment advice. Paper only.
