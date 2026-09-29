"""Pearson correlation helpers — pairwise deletion and PSD checks."""
import numpy as np

from pipeline.compute.corr_math import corr_from_returns


def test_pairwise_matches_numpy_on_clean_book():
    rng = np.random.default_rng(1)
    rets = rng.normal(0, 0.01, size=(100, 4))
    payload = corr_from_returns(["A", "B", "C", "D"], rets)
    mat = np.array(payload["matrix"], dtype=float)
    ref = np.corrcoef(rets, rowvar=False)
    assert np.nanmax(np.abs(mat - ref)) < 1e-4


def test_pairwise_ignores_bad_days_without_zero_fill():
    rng = np.random.default_rng(2)
    rets = rng.normal(0, 0.01, size=(100, 2))
    rets[10:20, 0] = np.nan
    payload = corr_from_returns(["A", "B"], rets)
    mat = np.array(payload["matrix"], dtype=float)
    mask = np.isfinite(rets[:, 0]) & np.isfinite(rets[:, 1])
    ref = np.corrcoef(rets[mask, 0], rets[mask, 1])[0, 1]
    assert mat[0, 1] == round(ref, 4)
    assert mat[0, 0] == 1.0


def test_symmetric_psd():
    rng = np.random.default_rng(3)
    rets = rng.normal(0, 0.012, size=(120, 5))
    rets[:, 1:] += rets[:, [0]] * 0.5
    mat = np.array(corr_from_returns(list("ABCDE"), rets)["matrix"], dtype=float)
    assert np.allclose(mat, mat.T, equal_nan=True)
    eig = np.linalg.eigvalsh(np.nan_to_num(mat))
    assert eig.min() >= -1e-8
