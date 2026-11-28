# Research data

## S&P 500 point-in-time membership

On first access, `pipeline/research/sp500_pit.py` downloads:

- **Source:** [fja05680/sp500](https://github.com/fja05680/sp500) — `S&P 500 Historical Components & Changes.csv` (free, daily from 1996).

Cached as `sp500_historical_components.csv` in this directory (not committed; fetch at runtime).

Long-format export: `python3 -c "from pipeline.research.sp500_pit import long_membership_csv; from pathlib import Path; print(long_membership_csv(Path('pipeline/research/data/sp500_membership_long.csv')))"`

Report charts: `pip install -r pipeline/requirements-research.txt`