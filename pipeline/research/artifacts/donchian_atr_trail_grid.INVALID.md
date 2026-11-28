# INVALID — do not cite

The JSON/CSV summaries in this folder that report **+307%** OOS return and **3.73** OOS Sharpe
(`donchian_atr_trail_grid.json`, related grid exports) are **invalid** because of:

1. Exit-day return not booked when stops fire (removed from holdings before P&L).
2. Portfolio re-levered to remaining names instead of holding cash.
3. ATR parameters selected by sorting on the same OOS window.
4. Survivorship-biased live S&P 500 + Nasdaq-100 universe.

Use `pipeline/research/LOOP_DONCHIAN_CORRECTED/REPORT.md` and
`pipeline/research/loop_donchian_harness.py` for corrected results.