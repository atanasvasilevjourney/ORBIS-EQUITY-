# Zarattini ORB validation — attribution

The backtest rules in `pipeline/research/zarattini_orb.py` are adapted from:

- **Repository:** [giovannibrusco/zarattini-2023-orb-qqq](https://github.com/giovannibrusco/zarattini-2023-orb-qqq)
- **License:** MIT (Copyright © 2026 Giovanni Brusco)
- **Paper:** Zarattini & Aziz, *Can Day Trading Really Be Profitable?* SSRN 4416622

Orbis changes for this validation:

- Universe: Orbis ORB **LIQUID** symbols + QQQ (not QQQ-only).
- Data: Yahoo 5m (~60d window) instead of bundled IB CSVs.
- Confirmation filter: **QQQ bar at 09:25 ET**, or **first bar ≥ 09:25** (Yahoo 5m starts at 09:30) instead of NQ futures.
