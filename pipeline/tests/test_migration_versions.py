"""Schema version control.

Applied Supabase migrations must not be renamed. New files must not reuse a
numeric prefix. The collisions below already shipped; they are frozen so a
fresh duplicate fails CI instead of landing beside them.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

# Historical pairs. Do not add a prefix here to silence a new file — pick the
# next free number. Remove a prefix only after a forward migration retires it.
KNOWN_COLLISIONS = {
    "006": frozenset({"006_equity_factors.sql", "006_kama_regime.sql"}),
    "007": frozenset({"007_adx_entry_timing.sql", "007_paper_loop.sql"}),
    "021": frozenset({"021_ema200_scanner.sql", "021_fundamental_analysis.sql"}),
}


def test_migration_prefixes_match_the_known_collisions():
    groups: dict[str, set[str]] = defaultdict(set)
    for path in MIGRATIONS.glob("*.sql"):
        prefix = path.name.split("_", 1)[0]
        assert prefix.isdigit() and len(prefix) == 3, path.name
        groups[prefix].add(path.name)

    collisions = {prefix: frozenset(names) for prefix, names in groups.items() if len(names) > 1}
    assert collisions == KNOWN_COLLISIONS


def test_migration_numbers_are_contiguous_from_001():
    prefixes = sorted({path.name.split("_", 1)[0] for path in MIGRATIONS.glob("*.sql")})
    numbers = [int(prefix) for prefix in prefixes]
    assert numbers[0] == 1
    assert numbers == list(range(1, numbers[-1] + 1))
