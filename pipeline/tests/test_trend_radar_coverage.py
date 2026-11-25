from unittest.mock import MagicMock, patch

import pandas as pd


def test_trend_radar_fails_below_coverage_threshold():
    from pipeline.compute import trend_radar as mod

    sb = MagicMock()
    run = MagicMock()

    universe = [{"symbol": f"S{i}", "tier": "large", "sector": "Tech", "industry": "", "is_active": True} for i in range(10)]

    prices = []
    for sym in ["S0"]:
        for d in range(60):
            prices.append(
                {
                    "symbol": sym,
                    "date": f"2026-01-{d+1:02d}",
                    "open": 10,
                    "high": 11,
                    "low": 9,
                    "close": 10 + d * 0.01,
                    "volume": 1_000_000,
                }
            )

    with (
        patch("pipeline.utils.supabase.fetch_all", side_effect=[universe, []]),
        patch("pipeline.utils.supabase.fetch_prices_since", return_value=prices),
        patch("pipeline.universe_filters.is_loop_tradable", return_value=True),
        patch.object(
            mod,
            "process_ticker",
            return_value={
                "state": 1,
                "quality_rank": 80,
                "z_mom": 1.0,
                "entry_timing": "watch",
                "f_ewmac": 2,
                "z_52": 0,
                "breakout_active": True,
                "volume_confirmed": False,
                "kama_regime": 0,
                "adx": 1,
                "convergence_count": 2,
                "daily_state": 1,
                "weekly_state": None,
            },
        ),
    ):
        mod._run_trend_radar(sb, run)

    run.mark_error.assert_called()
    err = run.mark_error.call_args[0][0]
    assert "coverage" in err.lower()