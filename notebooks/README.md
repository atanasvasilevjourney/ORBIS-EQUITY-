# Notebooks

Run from repo root:

```bash
pip install -r pipeline/requirements.txt matplotlib jupyter
PYTHONPATH=. jupyter notebook notebooks/zarattini_orb_universe_validation.ipynb
```

Or batch validation (writes `notebooks/output/` and `/opt/cursor/artifacts/zarattini_orb/`):

```bash
PYTHONPATH=. python3 -m pipeline.research.run_zarattini_orb_validation
```
