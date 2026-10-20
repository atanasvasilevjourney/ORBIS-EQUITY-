import inspect

from pipeline.compute.loop_atr_trail import LOOP_ATR_MULT, LOOP_ATR_PERIOD
from pipeline.compute.loop_harness import PRODUCTION_EXIT_MODE, loop_harness_config
from pipeline.research.donchian_vwap_backtest import run_donchian_vwap_portfolio


def test_loop_harness_production_atr_trail():
    cfg = loop_harness_config()
    assert cfg["exitMode"] == PRODUCTION_EXIT_MODE == "atr_trail"
    assert cfg["atrPeriod"] == LOOP_ATR_PERIOD == 14
    assert cfg["atrMult"] == LOOP_ATR_MULT == 2.0
    assert cfg["entryChannel"] == 55


def test_research_backtest_defaults_match_production():
    sig = inspect.signature(run_donchian_vwap_portfolio)
    assert sig.parameters["exit_mode"].default == "atr_trail"
    assert sig.parameters["atr_period"].default == 14
    assert sig.parameters["atr_mult"].default == 2.0
