/**
 * ORBIS common signal schema (v1) — TypeScript mirrors for adapters and API.
 * Canonical JSON Schema: docs/signals/schema.signal.v1.json
 * Narrative spec: docs/signals/common-signal-schema.md
 */

export const SIGNAL_SCHEMA_VERSION = "signal.v1" as const;

export type SignalSourceApp =
  | "orbis_equity"
  | "orbis_gex"
  | "cot_pulse"
  | "qmie"
  | "public";

export type SignalAssetClass =
  | "equity"
  | "index"
  | "crypto"
  | "fx"
  | "commodity"
  | "rates";

export type SignalHorizon = "short" | "medium" | "long";

export type SignalDirection = "long" | "short" | "flat";

export type SignalFreshness = "OK" | "STALE" | "MISSING";

export type EvidenceKind = "SOURCED" | "CALCULATED" | "ASSUMED";

export type SignalConfidence = "high" | "medium" | "low";

export type SignalEvidence = {
  label: string;
  url?: string | null;
  as_of?: string | null;
  kind: EvidenceKind;
};

/** Single normalized row from any upstream adapter. */
export type OrbisSignalV1 = {
  run_id: string;
  as_of: string;
  source_app: SignalSourceApp;
  source_module: string;
  asset_class: SignalAssetClass;
  symbol: string;
  venue_symbol?: string | null;
  horizon: SignalHorizon;
  direction: SignalDirection;
  forecast: number;
  probability?: number | null;
  validated?: boolean;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  invalidation?: string | null;
  rationale?: string | null;
  evidence?: SignalEvidence[];
  status: SignalFreshness;
  /** Set after confluence aggregation; omitted on raw source rows. */
  confidence?: SignalConfidence | null;
  wrong_test?: string | null;
};

/** Forecast scale aligned with Trend Diagnostics. */
export const SIGNAL_FORECAST_CAP = 20;
export const SIGNAL_FORECAST_MIN = -20;