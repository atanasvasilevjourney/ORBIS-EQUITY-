# ORBIS common signal schema (v1)

Cross-app contract for **ORBIS Equity**, **ORBIS GEX**, **COT Pulse**, **QMIE**, and **public** context feeds. Rows land in a future `signals_weekly` table (or JSON artifact) before **confluence scoring** and the Sunday Grok research routine.

- Machine-readable: [`schema.signal.v1.json`](./schema.signal.v1.json) (JSON Schema draft-07)
- TypeScript: [`src/lib/signals/types.ts`](../../src/lib/signals/types.ts)
- Integration plan: Project canvas `49a6ac32` (Equity Research Automation)
- Research pack: [`pipeline/research_framework/`](../pipeline/research_framework/), UI `/research-weekly`, `GET /api/research-weekly`

## Design principles

1. **One row per source contribution** — multiple rows per symbol/horizon are expected before aggregation.
2. **Shared forecast scale ±20** — same convention as Trend Diagnostics (`src/lib/trendDiagnostics.ts`).
3. **No invented numbers** — use `status: "MISSING"` and omit levels when unknown; mark evidence `kind` honestly.
4. **Validated sources count more** — unproven classifiers are down-weighted (see confluence).
5. **Paper research only** — schema carries levels for communication, not live orders.

## Field reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `run_id` | string | yes | e.g. `2026-W48` or job UUID |
| `as_of` | ISO-8601 UTC | yes | Snapshot time for this row |
| `source_app` | enum | yes | `orbis_equity`, `orbis_gex`, `cot_pulse`, `qmie`, `public` |
| `source_module` | string | yes | Fine-grained module id (see adapters below) |
| `asset_class` | enum | yes | `equity`, `index`, `crypto`, `fx`, `commodity`, `rates` |
| `symbol` | string | yes | Canonical ticker / perp |
| `venue_symbol` | string \| null | no | e.g. `ES=F` when `symbol` is `SPY` |
| `horizon` | enum | yes | `short`, `medium`, `long` |
| `direction` | enum | yes | `long`, `short`, `flat` |
| `forecast` | number | yes | −20 … +20 |
| `probability` | number \| null | no | 0–1 when source is calibrated |
| `validated` | boolean | no | Default `false` |
| `entry`, `stop`, `target` | number \| null | no | From research pack / GEX walls / QMIE |
| `invalidation` | string \| null | no | Text rule; may be tighter than `stop` |
| `rationale` | string \| null | no | One line |
| `evidence` | array | no | `{ label, url?, as_of?, kind }` |
| `status` | enum | yes | `OK`, `STALE`, `MISSING` |
| `confidence` | enum \| null | no | On **ideas** after confluence: `high`, `medium`, `low` |
| `wrong_test` | string \| null | no | Kill test for the aggregated idea |

### Horizon windows

| Horizon | Calendar | Primary modules (integration plan) |
|---------|----------|-----------------------------------|
| **short** | Days → 2 weeks | QMIE 1H/4H book, GEX regime/walls, research pack breakouts, COT 1w |
| **medium** | 2 → 6 weeks | Carver EWMAC, beta rotation, COT 4w, QMIE Trend Radar |
| **long** | ~2 → 6 months | Factor scores, valuation cycle, SEC lane, macro regime (FRED / brief) |

## Forecast scaling (adapters)

Map each upstream reading to `forecast` ∈ [−20, 20]:

| Source | Module examples | Mapping |
|--------|-----------------|---------|
| ORBIS Equity | `trend_diagnostics`, `carver_ewmac` | Use combined forecast as published (already ±20). |
| ORBIS Equity | `research_pack` | Long: +12 to +18 from trend+quality vote; short: symmetric negative; `flat` if no setup. |
| ORBIS GEX | `gex_regime` | `NEGATIVE_GAMMA` + spot below flip → negative bias scaled by distance to flip; positive gamma damped positive. |
| COT Pulse | `cot_1w`, `cot_4w` | `(probability − 0.5) × 40`, sign matches `direction`. |
| QMIE | `qmie_grade`, `qmie_radar` | Map grade A+→+18 … C→+4 (short book negates); blend component score if present. |
| public | `fred_spread`, `regime` | Discrete mapping documented per adapter; often `long`/`short` only for regime. |

Set `probability` only for COT Pulse (and any future calibrated models). Set `validated` from each app's walk-forward report (COT Pulse already flags per-market AUC / Sharpe).

## Confluence scoring (pseudocode)

Weights are **per horizon**; only rows with `status === "OK"` participate.

```text
HORIZON_WEIGHTS = {
  short:  { qmie: 0.30, gex: 0.25, orbis_equity: 0.30, cot_pulse: 0.15 },
  medium: { orbis_equity: 0.35, cot_pulse: 0.25, qmie: 0.20, orbis_gex: 0.10, public: 0.10 },
  long:   { orbis_equity: 0.45, public: 0.30, cot_pulse: 0.15, qmie: 0.05, orbis_gex: 0.05 },
}

function effectiveWeight(row):
  base = HORIZON_WEIGHTS[row.horizon][row.source_app] ?? 0
  if base == 0: return 0
  if row.validated != true: base *= 0.5
  return base

function confluenceScore(rows for symbol, horizon):
  ok = filter rows where status == "OK" and direction != "flat"
  if ok is empty: return null
  wSum = sum(effectiveWeight(r) for r in ok)
  if wSum == 0: return null
  score = sum(r.forecast * effectiveWeight(r) for r in ok) / wSum
  agreement = count distinct source_app where sign(forecast) == sign(score)
  return { score, agreement, contributors: ok }

function ideaConfidence(score, agreement, hasValidated):
  if abs(score) >= 10 and agreement >= 3 and hasValidated: return "high"
  if abs(score) >= 6 and agreement >= 2: return "medium"
  return "low"
```

**Ranking (Sunday routine):** Group by `horizon`, sort by `|score| × confidenceRank`, cap **5 ideas per horizon** and **2 per sector/crypto cluster**. Drop `STALE`/`MISSING` upstream rows instead of treating them as neutral zeros.

## Example row

```json
{
  "run_id": "2026-W48",
  "as_of": "2026-11-22T07:00:00Z",
  "source_app": "orbis_gex",
  "source_module": "gex_regime",
  "asset_class": "index",
  "symbol": "SPY",
  "venue_symbol": "SPX",
  "horizon": "short",
  "direction": "short",
  "forecast": -11.5,
  "probability": null,
  "validated": false,
  "entry": null,
  "stop": null,
  "target": null,
  "invalidation": "Close back above zero-gamma flip",
  "rationale": "Negative gamma; spot below flip",
  "evidence": [
    {
      "label": "ORBIS GEX /gex/SPY",
      "url": "https://orbis-gex.onrender.com/gex/SPY",
      "as_of": "2026-11-22T06:55:00Z",
      "kind": "SOURCED"
    }
  ],
  "status": "OK",
  "confidence": null,
  "wrong_test": null
}
```

## Future adapters (repo layout)

Planned paths (not all implemented):

| App | Adapter (proposed) | Upstream |
|-----|-------------------|----------|
| ORBIS Equity | `pipeline/signals/adapters/orbis_equity.py` | `/api/research-weekly`, `/api/diagnostics`, `/api/rotate`, `/api/cash` |
| ORBIS GEX | `pipeline/signals/adapters/orbis_gex.py` | `https://orbis-gex.onrender.com` |
| QMIE | `pipeline/signals/adapters/qmie.py` | `https://qmie.onrender.com` |
| COT Pulse | `pipeline/signals/adapters/cot_pulse.py` | HTTP export after PR 3 (`predictions.json`) |
| Confluence job | `pipeline/signals/jobs/weekly_confluence.py` | Writes ranked ideas + persists raw rows |

Protected ORBIS Equity routes require `x-api-key` when `API_SECRET` is set (`src/middleware.ts`). Adapters should read keys from environment in GitHub Actions, never commit secrets.

## Related docs

- Project store: `/cursor/stores/self/docs/combined-equity-research-framework.md` — weekly research pack
- [`docs/DECISIONS.md`](../DECISIONS.md) — EMA200 watchlist-only and research gates
- [`docs/MULTI_AGENT_TESTING.md`](../MULTI_AGENT_TESTING.md) — agent workflow for adapter PRs