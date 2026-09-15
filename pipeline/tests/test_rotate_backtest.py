"""Offline quant tests for sector-rotation canaries + correlation."""
import numpy as np

from pipeline.compute.canary_math import build_canaries, group_aligned
from pipeline.compute.corr_math import corr_from_returns
from pipeline.research.rotate_backtest import synthetic_books, validate_rotation


def test_qqq_spy_votes_tech_lead():
    books = synthetic_books(300)
    reg = build_canaries(books)
    qqq = next(v for v in reg.votes if v.name == "QQQ/SPY")
    assert qqq.vote == 1
    assert len(qqq.tape) > 10
    assert reg.regime in {"RISK-ON", "STRONG RISK-ON"}


def test_alignment_matches_regime():
    assert group_aligned("cyclical", "LEAD", "RISK-ON")
    assert not group_aligned("defensive", "LEAD", "RISK-ON")
    assert group_aligned("defensive", "LEAD", "RISK-OFF")


def test_corr_symmetric_psd():
    rng = np.random.default_rng(0)
    rets = rng.normal(0, 0.01, size=(180, 5))
    payload = corr_from_returns(["A", "B", "C", "D", "E"], rets)
    mat = np.array(payload["matrix"], dtype=float)
    assert payload["labels"] == ["A", "B", "C", "D", "E"]
    assert np.allclose(mat, mat.T, equal_nan=True)
    eig = np.linalg.eigvalsh(mat)
    assert eig.min() >= -1e-8
    assert np.allclose(np.diag(mat), 1.0, atol=1e-8)


def test_canary_overlay_beats_univ_on_tech_lead():
    q = validate_rotation(300)
    assert q.qqq_vote == 1
    assert q.overlay_total > q.univ_total * 0.9
    assert q.corr_min_eig >= -1e-6
    assert "tech" in q.corr_labels
