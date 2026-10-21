# Multi-Agent Testing Guide for ORBIS EQUITY

This document describes how to run ORBIS EQUITY's multi-agent testing workflow using Cursor Cloud Agent subagents.

## Architecture

```mermaid
flowchart TD
    orchestrator[OrchestratorAgent]
    orchestrator --> exploreAgent[ExploreAgent_CodeAudit]
    orchestrator --> pipelineAgent[PipelineAgent_pytest]
    orchestrator --> apiAgent[ApiAgent_Vitest]
    orchestrator --> uiAgent[UiAgent_Playwright]
    orchestrator --> reviewAgent[BugbotAgent_Review]

    pipelineAgent --> fixtures[TestFixtures]
    apiAgent --> fixtures
    uiAgent --> fixtures

    fixtures --> ci[GitHubActions_test.yml]
    reviewAgent --> ci
```

## Subagent Roles

| Subagent | Scope | Commands | Deliverable |
|----------|-------|----------|-------------|
| **explore** | Code audit, find untested paths | Read-only scan of `pipeline/`, `src/app/api/`, `src/components/` | Coverage gap report |
| **generalPurpose (pipeline)** | Run + extend pytest | `python3 -m pytest pipeline/tests -v` | Pass/fail + new compute tests |
| **generalPurpose (api)** | Run + extend Vitest | `npm test` | Pass/fail + route handler tests |
| **computerUse** | Manual UI verification | Start dev server, navigate pages | Screen recording + bug list |
| **bugbot** | Review diff after tests | Run on branch changes | P0/P1 issue list |

## Parallel Launch Pattern

### Turn 1 (parallel)

Launch these subagents simultaneously:

```
explore:
  "Map all testable surfaces in ORBIS EQUITY; list P0 coverage gaps in pipeline compute,
   API routes, and UI pages."

generalPurpose (pipeline):
  "Run `python3 -m pytest pipeline/tests -v`. Fix any failures. Add tests for
   uncovered compute functions if gaps are found."

generalPurpose (api):
  "Run `npm test`. Fix any failures. Ensure all 7 API routes under src/app/api/
   have at least one happy-path and one error test."
```

### Turn 2 (after unit tests green)

```
computerUse:
  "Start `npm run dev`, smoke-test dashboard (/), screener (/screener),
   fundamentals (/fundamentals), health (/health), earnings-news (/earnings-news).
   Verify nav links, theme toggle, and no console errors."

bugbot:
  "Review branch changes. Diff: branch changes. Report P0/P1 issues in test
   infrastructure and any production code touched."
```

### Turn 3 (synthesis)

The orchestrator:

1. Merges subagent findings into a single report
2. Ensures CI workflow (`.github/workflows/test.yml`) is green
3. Opens or updates the PR with test results summary

## Running Tests Locally

### Python pipeline

```bash
pip install -r pipeline/requirements.txt
python3 -m pytest pipeline/tests -v
```

### Next.js API

```bash
npm install
npm test
```

### E2E (Playwright)

```bash
npm install
npx playwright install chromium
npm run dev   # in separate terminal
npm run test:e2e
```

## Test Coverage by Layer

### Pipeline (pytest)

- **Unit:** `trend_radar` watchlist math, `watchlist_backtest` (production module 1), `f_score` Piotroski criteria
- **Integration:** DAG smoke test mirroring `.github/workflows/nightly-pipeline.yml`
- **Location:** `pipeline/tests/`

### API (Vitest)

There are 25 route handlers under `src/app/api/`. These have a Vitest file:

| Route | Tests |
|-------|-------|
| `/api/screener` | Filters, limit cap, error handling |
| `/api/summary` | Breadth stats, stale detection |
| `/api/fundamentals` | Row flattening, sector list |
| `/api/fundamentals/[ticker]` | Ticker validation, report trends |
| `/api/fundamentals/screener` | Screener payload |
| `/api/earnings-news` | Earnings + news payload |
| `/api/ticker/[ticker]` | Detail payload, 404/500 paths |
| `/api/ema200` | Watchlist payload |
| `/api/skew` | Skew payload |
| `/api/quantropy` | Empty desk, no lite recompute |
| `/api/rotate` | Empty desk, no lite recompute |

These routes have no route test yet: `/api/dashboard`, `/api/loop`, `/api/orb`, `/api/cash`, `/api/perps`, `/api/analysis`, `/api/bias`, `/api/health`, `/api/triangle`, `/api/chart/[ticker]`, `/api/status`, `/api/symbols/search`, `/api/universe/export`, `/api/ticker/[ticker]/prices`.

Score math is covered in Python (`test_factor_scores`, `test_quantropy` alignment / Z proxy / clean returns, `test_weekend_vol`, `test_orb_brackets`) and in `src/lib/__tests__/capitalBook.test.ts`.

- **Location:** `src/app/api/__tests__/`

### UI (Playwright)

Smoke loads `/`, `/screener`, `/triangle`, `/ema200`, `/fundamentals`, `/fundamentals/screener`, `/health`, `/earnings-news`.
Paper desks (`/loop`, `/orb`, `/skew`, `/analysis`, `/bias`, `/cash`, `/rotate`, `/quantropy`, `/status`) are not in that smoke list.
- **Location:** `e2e/`

## Success Criteria

| Layer | Green condition |
|-------|-----------------|
| Pipeline unit | `pytest pipeline/tests` passes |
| API | `npm test` passes; covered routes stay green. New score math needs a unit test before a new page-load test. |
| UI smoke | Playwright e2e passes (or computerUse confirms pages load) |
| Review | bugbot reports no unresolved P0 issues |
| CI | `test.yml` green on PR branch |

## CI Integration

Tests run automatically on push and pull_request via `.github/workflows/test.yml`:

- **python-tests** — pytest on Python 3.12
- **frontend-tests** — Vitest via `npm test`

Subscribe to CI results after pushing using the `cursor-subscriptions` MCP `subscribe_github_ci` tool.
