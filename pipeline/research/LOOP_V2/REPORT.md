# LOOP v2 backtest report

**PR:** https://github.com/atanasvasilevjourney/ORBIS-EQUITY-/pull/128

**Evaluation end:** 2026-11-21 · **Deflated Sharpe trials:** 6

Six pre-declared runs: (1) LOOP v2 full, (2–4) VWAP ablations, (5) baseline Donchian LOOP, (6) SPY.

## Pass / fail (LOOP v2 full vs SPY @ 25 bps)

- **2010+:** FAIL
- **2019+ (OOS):** FAIL
- **Overall:** FAIL

_Criterion: v2 Sharpe > SPY Sharpe and |max DD| smaller than SPY in both windows at 25 bps/side._

## Results table (25 bps)

| Run | Period | CAGR | Total | Vol | Sharpe | D.Sharpe | MaxDD | Turnover | Avg names | % invested | VWAP fill % |
|-----|--------|------|-------|-----|--------|----------|-------|----------|-----------|------------|-------------|
| 1 loop_v2_full | full | +7.1% | +218.6% | +13.5% | 0.58 | 0.55 | -21.9% | 102.8 | 25.6 | 95% | 98% |
| 2 v2_no_vwap_entry | full | +6.2% | +174.9% | +13.5% | 0.51 | 0.48 | -23.2% | 100.9 | 25.8 | 95% | 0% |
| 3 v2_no_vwap_stop | full | +8.1% | +271.2% | +13.9% | 0.63 | 0.60 | -25.3% | 83.8 | 26.5 | 98% | 98% |
| 4 v2_no_vwap_either | full | +7.9% | +258.9% | +13.9% | 0.61 | 0.59 | -25.7% | 81.9 | 26.7 | 98% | 0% |
| 5 baseline_loop | full | -22.9% | -98.8% | +14.2% | -1.75 | -1.78 | -98.8% | 0.0 | 6.2 | 99% | 0% |
| 6 SPY | full | +13.3% | +717.6% | +17.1% | 0.82 | 0.82 | -33.7% | 0.0 | 1.0 | 100% | 0% |
| 1 loop_v2_full | oos | +7.6% | +77.5% | +14.4% | 0.58 | 0.54 | -17.9% | 220.1 | 25.6 | 95% | 98% |
| 2 v2_no_vwap_entry | oos | +6.5% | +64.3% | +14.4% | 0.51 | 0.47 | -18.4% | 216.1 | 25.8 | 95% | 0% |
| 3 v2_no_vwap_stop | oos | +8.0% | +82.8% | +14.4% | 0.60 | 0.56 | -18.4% | 179.3 | 26.5 | 98% | 98% |
| 4 v2_no_vwap_either | oos | +7.6% | +78.2% | +14.4% | 0.58 | 0.54 | -18.4% | 175.4 | 26.7 | 98% | 0% |
| 5 baseline_loop | oos | -27.7% | -92.2% | +16.3% | -1.90 | -1.94 | -92.3% | 0.0 | 6.2 | 99% | 0% |
| 6 SPY | oos | +15.4% | +209.3% | +19.3% | 0.84 | 0.84 | -33.7% | 0.0 | 1.0 | 100% | 0% |

## Results table (10 bps)

| Run | Period | CAGR | Total | Vol | Sharpe | D.Sharpe | MaxDD | Turnover | Avg names | % invested | VWAP fill % |
|-----|--------|------|-------|-----|--------|----------|-------|----------|-----------|------------|-------------|
| 1 loop_v2_full | full | +8.6% | +301.9% | +13.4% | 0.68 | 0.65 | -20.8% | 102.8 | 25.6 | 95% | 98% |
| 2 v2_no_vwap_entry | full | +7.6% | +246.2% | +13.5% | 0.61 | 0.58 | -22.1% | 100.9 | 25.8 | 95% | 0% |
| 3 v2_no_vwap_stop | full | +9.2% | +338.9% | +13.9% | 0.70 | 0.67 | -24.7% | 83.8 | 26.5 | 98% | 98% |
| 4 v2_no_vwap_either | full | +8.9% | +323.3% | +13.9% | 0.69 | 0.66 | -25.2% | 81.9 | 26.7 | 98% | 0% |
| 5 baseline_loop | full | -11.4% | -87.0% | +13.9% | -0.80 | -0.83 | -87.6% | 0.0 | 6.2 | 99% | 0% |
| 6 SPY | full | +13.3% | +717.6% | +17.1% | 0.82 | 0.82 | -33.7% | 0.0 | 1.0 | 100% | 0% |
| 1 loop_v2_full | oos | +9.1% | +99.0% | +14.3% | 0.68 | 0.64 | -17.6% | 220.1 | 25.6 | 95% | 98% |
| 2 v2_no_vwap_entry | oos | +8.0% | +83.7% | +14.3% | 0.61 | 0.57 | -17.6% | 216.1 | 25.8 | 95% | 0% |
| 3 v2_no_vwap_stop | oos | +9.1% | +98.5% | +14.4% | 0.68 | 0.63 | -17.9% | 179.3 | 26.5 | 98% | 98% |
| 4 v2_no_vwap_either | oos | +8.7% | +93.3% | +14.4% | 0.65 | 0.61 | -17.9% | 175.4 | 26.7 | 98% | 0% |
| 5 baseline_loop | oos | -16.7% | -76.3% | +16.0% | -1.06 | -1.11 | -76.6% | 0.0 | 6.2 | 99% | 0% |
| 6 SPY | oos | +15.4% | +209.3% | +19.3% | 0.84 | 0.84 | -33.7% | 0.0 | 1.0 | 100% | 0% |

## Charts

![Total return by run](equity_curves.png)

![Sharpe by window](sharpe_by_window.png)

## Data caveats

- Universe: PIT S&P 500 (fja05680/sp500) ∪ Nasdaq-100 (Wikipedia change log; seed 2008-12-22).
- Dual share classes deduped (e.g. GOOGL over GOOG).
- NDX history before seed date may retain mild survivorship.
- GICS sector caps use live sector map where missing (Unknown bucket).
- Prices: yfinance auto_adjust=True.
