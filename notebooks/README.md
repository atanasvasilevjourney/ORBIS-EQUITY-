# Research notebooks

## TEMA top-10 OOS (`tema_top10_oos.ipynb`)

TEMA-only (9/99/199 + MACD close) book research: rank names on **in-sample** Sharpe, validate on **out-of-sample**, and promote a top-10 list only if the OOS gate passes.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r pipeline/requirements-notebooks.txt
jupyter notebook notebooks/tema_top10_oos.ipynb
```

CLI equivalent:

```bash
PYTHONPATH=. python -m pipeline.research.tema_top10_oos --top 10
```

Not investment advice. Paper research harness only.
