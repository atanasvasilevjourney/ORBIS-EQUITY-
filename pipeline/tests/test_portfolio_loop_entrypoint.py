"""Portfolio loop must expose a CLI entrypoint (nightly job regression)."""


def test_portfolio_loop_module_has_main():
    from pipeline.compute import portfolio_loop

    assert callable(portfolio_loop.main)


def test_portfolio_loop_has_main_guard_in_source():
    from pathlib import Path

    text = Path("pipeline/compute/portfolio_loop.py").read_text(encoding="utf-8")
    assert 'if __name__ == "__main__"' in text
