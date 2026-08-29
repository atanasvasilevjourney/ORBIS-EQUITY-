-- ============================================================================
-- KovaView Terminal — Migration 013: TEMA + Carver equity-perp paper desk
-- Separate from LOOP / ORB / BIAS. Signals on listed names; size as USDT-M
-- perpetuals. Paper only — no live exchange orders.
-- ============================================================================

CREATE TABLE perp_runs (
    run_id          TEXT        PRIMARY KEY,
    asof_date       DATE        NOT NULL,
    names           SMALLINT,
    tema_slots      SMALLINT,
    carver_slots    SMALLINT,
    gross_leverage  REAL,
    headline        TEXT,
    config          JSONB,
    computed_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_perp_runs_asof ON perp_runs (asof_date DESC);

CREATE TABLE perp_names (
    symbol              TEXT        PRIMARY KEY,
    run_id              TEXT        REFERENCES perp_runs(run_id),
    company_name        TEXT,
    sector              TEXT,
    last_px             REAL,
    perp_symbol         TEXT,
    venue               TEXT,
    venue_listed        BOOLEAN,
    mark_px             REAL,
    funding_8h          REAL,
    funding_ann         REAL,
    tema_side           TEXT,
    tema_grade          TEXT,
    tema_score          REAL,
    tema_t8             REAL,
    tema_t21            REAL,
    tema_t55            REAL,
    tema_stop           REAL,
    tema_tp             REAL,
    tema_weight_pct     REAL,
    tema_notional       REAL,
    tema_leverage       REAL,
    tema_margin         REAL,
    tema_liq            REAL,
    carver_forecast     REAL,
    carver_ewmac_fast   REAL,
    carver_ewmac_slow   REAL,
    carver_vol          REAL,
    carver_side         TEXT,
    carver_notional     REAL,
    carver_leverage     REAL,
    carver_margin       REAL,
    carver_liq          REAL,
    atr                 REAL,
    atr_pct             REAL,
    in_tema_book        BOOLEAN,
    in_carver_book      BOOLEAN,
    skip_reason         TEXT,
    rationale           TEXT,
    computed_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_perp_names_run ON perp_names (run_id);
CREATE INDEX idx_perp_names_tema ON perp_names (in_tema_book);
CREATE INDEX idx_perp_names_carver ON perp_names (in_carver_book);

ALTER TABLE perp_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE perp_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON perp_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON perp_names FOR SELECT TO anon USING (true);

CREATE POLICY "service_all" ON perp_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON perp_names FOR ALL TO service_role USING (true) WITH CHECK (true);
