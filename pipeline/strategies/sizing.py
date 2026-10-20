from __future__ import annotations


def equal_weight_size_hint(n_names: int, equity: float = 100_000.0) -> float:
    """Target notional per name for an N-name equal-weight sleeve."""
    if n_names <= 0:
        return 0.0
    return equity / n_names
