# Build a Local AI Equity Research Analyst with Cursor

**Source:** Reconstruction inspired by [Automated Alpha — “I built a $200,000/year equity research…”](https://automatedalpha.substack.com/p/i-built-a-200000year-equity-research) (Jurgis Pocius). The full post is paywalled; this guide uses only the public preview plus an independent architecture. It is **not** a copy of paid content.

**Goal:** A five-phase research pipeline (scan → ingest → value → stress → memo) where **Python computes every number** and the LLM **only narrates** structured facts, with a **separate verifier** that rejects hallucinated figures.

---

## 0. What the preview confirms vs. what we reconstructed

| Confirmed (public preview) | Reconstructed here (your build) |
| --- | --- |
| Built with Claude Code + Google Antigravity, runs locally | Cursor Agent + Python stack (same separation of compute vs. narrative) |
| Market scanner: undervalued/overvalued, special situations, sector rotation | Module layout, z-score screens, `SpecialSituation` enum |
| Ranked by **conviction** and **urgency**, sector **heat map** | Formulas in Prompt 3 (unit-tested, not proprietary) |
| **5-phase pipeline** → investment memo | Phases 1–5 below |
| Live **10Y Treasury → WACC** | FRED `DGS10` in Prompt 2–4 |
| **1,000-run Monte Carlo** full DCF | Prompt 6 |
| Alt-data fusion, stress tests, error handling | Prompt 7 + orchestrator degradation rules |

---

## 1. System decomposition

| Phase | Job | Output |
| --- | --- | --- |
| 1. Scan | Screen universe, dislocations, special situations | Ranked `ScanCandidate` list, heat map PNG |
| 2. Ingest | Filings, prices, macro, estimates → local store | Point-in-time fundamentals DB |
| 3. Value | Bear/base/bull DCF + comps cross-check | Per-scenario fair value |
| 4. Stress | Monte Carlo, sensitivity, alt-data overlay | Value distribution, risk flags |
| 5. Write | LLM memo from `MemoFacts` JSON only | Markdown/PDF + verifier pass |

**Core principle:** The LLM never produces a financial number. Python emits pydantic-validated JSON; the writer cites fact IDs; the verifier regex-matches every number in the memo against that JSON.

---

## 2. Leverage and bottlenecks

**Leverage**

- Deterministic valuation core + narration layer → auditable, repeatable across hundreds of tickers.
- One orchestrator: `analyst research AAPL` with versioned artifacts under `data/runs/<ticker>/<timestamp>/`.

**Bottlenecks**

1. **Data quality** — restatements, survivorship bias, XBRL tag chaos.
2. **DCF assumptions** — terminal value often >60% of EV; Monte Carlo on bad inputs is false precision (report **terminal-value share** and **comps disagreement**).
3. **Context/cost** — extract filings to structured facts before summarization.

---

## 3. Recommended stack

- **Runtime:** Python 3.12, `uv` or Poetry, `pydantic` v2, `pandas`/`polars`, DuckDB or SQLite.
- **Data:** SEC EDGAR (XBRL company facts), FRED (`DGS10`), prices (yfinance for proto; paid feed for production), optional estimates API.
- **LLM:** Claude (or configured provider) for extraction + memo; model name in run manifest.
- **CLI:** `typer`. **Packaging:** Docker. **PDF:** WeasyPrint or Pandoc.

---

## 4. Project layout

```text
equity-analyst/
  .cursor/rules/project.mdc
  agents/
    data_adapter/.cursor/rules/
    memo_writer/.cursor/rules/
    verifier/.cursor/rules/
    valuation_reviewer/.cursor/rules/
    scanner_tuner/.cursor/rules/
  src/analyst/
    config.py  schemas.py  cli.py
    data/      edgar.py fred.py prices.py store.py
    scan/      screens.py special_sits.py ranking.py heatmap.py
    valuation/ wacc.py dcf.py scenarios.py comps.py
    stress/    montecarlo.py sensitivity.py altdata.py
    memo/      facts.py writer.py verifier.py templates/
    pipeline.py
  tests/  fixtures/
  data/ (gitignored)
  docker-compose.yml  Dockerfile  pyproject.toml
```

---

## 5. Multi-agent roles (who does what)

Use **separate Cursor sessions** (or containers) so the verifier never shares context with the memo writer.

| Agent | Responsibility | Write access |
| --- | --- | --- |
| **Data-adapter fixer** | When EDGAR or a price feed breaks, patch the adapter and open a PR | `src/analyst/data/` only |
| **Memo writer** | Reads **only** `MemoFacts` JSON; drafts memo | `memo/templates/`, generated memos under `data/runs/` |
| **Verifier** | Fresh context; every memo number ↔ facts JSON | Read-only code; may fail CI |
| **Valuation reviewer** | Critiques assumptions; flags TV >75% EV or >30% comps disagreement | **Read-only** — never edits DCF |
| **Scanner tuner** | Proposes factor/weight changes **only** via backtest PR | `scan/` + `tests/backtest/` |

Orchestrator (you or `pipeline.py`) moves **JSON artifacts** between phases; it rejects anything that fails pydantic validation.

---

## 6. Where agents run

### Local (laptop / homelab)

- **One Docker container per agent**, each with its own venv.
- Run **Cursor CLI headless** inside the container for automated fix loops. Headless typically needs non-interactive flags (e.g. `-p` and `--trust`) or the agent hangs on permission prompts.
- **Mount only** the folders that agent needs; give each agent its own **git worktree** so parallel runs do not stomp the same branch.

### Cloud (Cursor Background Agents)

- Isolated Ubuntu VM; environment defined in **`.cursor/environment.json`** (commit to repo).
- Good for nightly ingest, adapter fix PRs, and batch `analyst batch tickers.txt`.
- Background agents have **internet access** — treat filings, news, and scraped pages as **untrusted** (prompt injection). Keep internet-facing agents away from secrets and broad write paths.

---

## 7. Contracts and guardrails

1. **Artifacts:** pydantic-validated JSON only between phases (`ScanCandidate`, `DCFResult`, `MonteCarloResult`, `MemoFacts`, …). Orchestrator rejects invalid payloads.
2. **Per-agent rules:** Each agent directory has its own `.cursor/rules/*.mdc` plus a **write allow-list** (path globs).
3. **Valuation changes:** Must pass unit tests + **frozen two-ticker regression** before merge; human approval for `valuation/` and `stress/`.
4. **Prompt injection:** Ingest/extraction agents read external text — no API keys in their env, no `git push` to main.
5. **Cost / determinism:** Per-run token budget; run manifest logs `git` commit, model, seed, `as_of` date.
6. **Writer/verifier isolation:** If writer and verifier share one chat, they will “agree” on wrong numbers — always separate sessions.

---

## 8. Cursor workflow (human in the loop)

1. **Agent mode**, **fresh chat per prompt** below.
2. Attach `@schemas.py` and `@.cursor/rules` on later prompts.
3. **Commit after each prompt**; revert if tests go red.
4. Do not stack prompts until the previous step’s tests pass.

---

## 9. Prompt playbook (copy into Cursor)

### Prompt 0 — Project rules (save as `.cursor/rules/project.mdc`)

```text
You are a senior quant engineer. Project: local equity research pipeline.
Rules:
1. Python 3.12, type hints everywhere, pydantic v2 models for all data contracts.
2. NEVER let an LLM generate financial numbers. All numbers come from tested Python functions.
3. Every external call: timeout, retry with exponential backoff, on-disk cache, structured logging.
4. Store point-in-time data: keep filing date and period end for every fundamental; never use data not public as of the analysis date.
5. Every module gets pytest tests with fixtures; no network in unit tests.
6. Secrets only via environment variables; never hardcode keys.
7. Fail loudly with typed exceptions; never silently fill missing values.
Before coding, state your plan in 5 bullets. After coding, list what you did not verify.
```

### Prompt 1 — Scaffold monolith repo

```text
Scaffold the repo per layout in docs/LOCAL_AI_EQUITY_RESEARCH_ANALYST_WITH_CURSOR.md section 4.
Use uv, pyproject with ruff + mypy + pytest, typer CLI entry `analyst`, config via pydantic-settings.
Create schemas.py: Ticker, FilingFact, PriceBar, MacroPoint, ScenarioAssumptions, DCFResult, MonteCarloResult, ScanCandidate, MemoFacts, RunManifest.
Makefile: lint, test, run. Stub modules only — no business logic yet.
```

### Prompt 1b — Scaffold multi-agent + Docker (run after Prompt 1)

```text
Add multi-agent scaffolding:
- agents/{data_adapter,memo_writer,verifier,valuation_reviewer,scanner_tuner}/ each with .cursor/rules defining role, allowed write paths, and forbidden actions (verifier: no code writes; valuation_reviewer: read-only valuation).
- docker-compose.yml: one service per agent, shared read-only `src/analyst/schemas.py` and `tests/fixtures`, separate worktree mount per service.
- orchestrator script `scripts/agent_dispatch.py` that validates JSON artifacts between phases using schemas.py.
- Document headless Cursor CLI invocation in agents/README.md (non-interactive flags, trust, folder mounts).
Do not implement agent logic — only structure, rules files, and compose.
```

### Prompt 2 — Data layer

```text
Implement src/analyst/data/.
- edgar.py: XBRL company facts from SEC EDGAR (User-Agent from env, ≤10 req/s). Map revenue, EBIT, D&A, capex, ΔNWC, cash, debt, diluted shares, tax rate; filed date + period end per fact.
- fred.py: DGS10 with cache; latest valid value + date.
- prices.py: daily OHLCV via yfinance behind swappable interface.
- store.py: DuckDB upsert + as_of(date) queries (only facts filed on or before analysis date).
Tests with recorded fixtures; explicit handling for missing tags, restatements, fiscal-year mismatch.
```

### Prompt 3 — Market scanner

```text
Implement src/analyst/scan/.
- screens.py: valuation percentile vs sector (EV/EBIT, FCF yield, P/E), quality (ROIC, margin trend, accruals), momentum; z-score flags for cheap/expensive.
- special_sits.py: 13D/13G, activist 8-K, spinoff/merger 8-K, index add/delete from user CSV; SpecialSituation enum.
- ranking.py: conviction (0–100) and urgency (0–100), documented formula, unit tests; output list[ScanCandidate].
- heatmap.py: sector relative strength + ETF volume proxy → PNG.
CLI: analyst scan --universe sp500 --top 25
```

### Prompt 4 — WACC and DCF core

```text
Implement valuation/wacc.py and valuation/dcf.py.
WACC: rf = live 10Y FRED; ERP default 4.5%; beta 5y weekly vs SPY + Blume; cost of debt = interest/average debt; market-value weights; return breakdown object.
DCF: 5–10y unlevered FCF from drivers; Gordon terminal with g < rf; mid-year discount option; EV → equity → per share.
Guardrails: raise if g >= WACC; warn if terminal value > 75% of EV.
Tests vs hand-computed spreadsheet fixture.
```

### Prompt 5 — Scenarios and comps

```text
Implement valuation/scenarios.py and comps.py.
Scenarios: bear/base/bull from historical growth/margin percentiles (25/50/75) + YAML overrides; probability-weighted value.
Comps: peers by SIC + market-cap band; median EV/EBIT, EV/Sales, P/E; flag if DCF vs comps median differ >30%.
```

### Prompt 6 — Monte Carlo and sensitivity

```text
Implement stress/montecarlo.py and sensitivity.py.
Monte Carlo: 1000 runs (configurable, seedable), full DCF each draw; sample growth, margin, WACC, terminal g with fitted distributions + correlation; vectorized numpy.
Output: percentiles 5/25/50/75/95, P(value > price), top-3 drivers via rank correlation.
Also: WACC×terminal-g and growth×margin sensitivity tables.
Tests: fixed seed reproducibility; resample draws where g >= WACC.
Report terminal-value share of EV in MonteCarloResult.
```

### Prompt 7 — Alternative data fusion

```text
Implement stress/altdata.py: AltDataSource plugin (name, fetch(ticker)->list[Signal], freshness, license).
Starters (no paid keys): Google Trends (pytrends), EDGAR Form 4 net insider, short interest from user CSV.
Fuse to signed score with weights; alt data adjusts risk flags and scenario probabilities only — never DCF inputs directly.
```

### Prompt 8 — Memo + verifier (anti-hallucination)

```text
Implement memo/facts.py, memo/writer.py, memo/verifier.py.
facts.py: assemble MemoFacts from all prior phases (every number: source, date, computation_id).
writer.py: LLM system prompt — write ONLY from JSON; missing → "not available"; cite [fact_id] after every number; sections: Thesis, Valuation (3 scenarios + MC band), Catalysts, Risks, What would change my mind.
verifier.py: extract numbers from memo; assert each exists in MemoFacts within rounding tolerance; fail build; one retry max.
Render Markdown + PDF; embed heat map + football-field chart.
IMPORTANT: verifier runs in a separate agent session with no writer transcript.
```

### Prompt 9 — Orchestrator

```text
Implement pipeline.py + cli.py: analyst research TICKER [--as-of DATE] [--refresh].
Each phase writes versioned JSON under data/runs/<ticker>/<timestamp>/; phases resumable individually.
Run manifest: git commit, as_of, model, seed, token usage.
Partial failure: alt-data fail → continue degraded; valuation fail → abort.
analyst batch tickers.txt with concurrency limit.
```

### Prompt 10 — Tests, backtest, CI

```text
Integration tests: frozen two-ticker dataset through full pipeline.
Backtest harness: month-end walk-forward scan + valuation with as_of only; top-decile conviction; forward 3/6/12m excess vs SPY and sector ETF; turnover + costs; report hit rate, Spearman IC, drawdown.
Dockerfile (slim, non-root), compose cron scheduler, GitHub Actions: lint, mypy, pytest.
Valuation PRs must pass frozen regression gate.
```

### Prompt 11 — Data-adapter fixer (operational)

```text
You are the data-adapter fixer agent. Symptom: [paste stack trace / failing ticker].
Rules: only edit src/analyst/data/; add or update fixture; no changes to valuation/.
Reproduce with pytest -k edgar; fix root cause; open PR with failing test that now passes.
Do not disable retries or swallow errors.
```

### Prompt 12 — Valuation reviewer (read-only critique)

```text
You are the valuation reviewer. Read-only access to valuation/ and stress/.
Given MemoFacts + DCFResult JSON for TICKER, produce a markdown comment (max 400 words):
- Are growth/margin paths plausible vs 5y history?
- Terminal value % of EV?
- Comps disagreement flags?
- Banks/REITs mis-routed?
You must NOT edit code or assumptions files. Output: REVIEW.md only.
```

---

## 10. Backtesting (scanner trust)

- Point-in-time fundamentals **as filed**, not restated later.
- Include **delisted** names or survivorship bias inflates results.
- Measure **IC** (Spearman: conviction vs forward return), not only top-decile P&L.
- Walk-forward weights; hold out a **lockbox** period.
- Calibrate Monte Carlo: does price land inside the 90% band ~90% of the time?

---

## 11. Risks (short table)

| Risk | Mitigation |
| --- | --- |
| LLM invents numbers | MemoFacts + separate verifier |
| Look-ahead bias | `as_of` store |
| False precision | TV share, comps flag, reviewer agent |
| XBRL mapping errors | Overrides + BS identity checks |
| Banks / REITs | Route to other models or exclude |
| Prompt injection on filings | Split agents; no secrets on ingest |
| Cost runaway | Token budget + caches keyed by filing hash |

---

## 12. Relation to this repository (KovaView)

KovaView already has **fundamental snapshots**, F-Score, and factor ranks (`docs/FUNDAMENTAL_ANALYSIS.md`, `pipeline/compute/`). It does **not** yet implement the full **DCF + Monte Carlo + verified memo** stack described here. You can either:

- **Greenfield** the `equity-analyst/` layout in a new repo (cleanest for the article’s architecture), or
- **Extend** KovaView by adding `pipeline/research/dcf/` and memo export, reusing ingest and `financial_reports`.

---

## 13. First-week build order

1. Prompts **0 → 2** — trustworthy data.
2. Prompts **4 → 5** — valuation vs spreadsheet.
3. Prompt **6** — Monte Carlo.
4. Prompt **8** — memo + verifier (separate sessions).
5. Prompts **3 + 9** — scanner + orchestrator.
6. Prompts **1b, 7, 10** — multi-agent Docker, alt data, backtest.

Ship **one sector** end-to-end before scaling universe breadth.

---

## 14. Monetization (skeptical framing)

“$200,000/year” in the title refers to **replacing an analyst’s cost**, not guaranteed revenue. Defensible paths: personal process edge, subscription with **published calibration**, automation consulting for small funds, or scheduled artifact packs. **Distribution and track record** matter more than the pipeline code.

---

*Last updated: 2026-10-12. Revisit when Automated Alpha publishes more public detail.*
