-- ============================================================================
-- KovaView Terminal — Schema v1
-- Equity swing-trading terminal: universe management, EOD prices, fundamentals,
-- trend radar signals, pharma/biotech pipeline, earnings, news, insider trades,
-- and daily AI briefs.
--
-- Supabase / PostgreSQL
-- Generated: 2026-07-28
-- ============================================================================

-- ==========================================================================
-- 1. universe_members — which stocks are in our universe
-- ==========================================================================
CREATE TABLE universe_members (
    symbol              TEXT        PRIMARY KEY,
    company_name        TEXT,
    sector              TEXT,
    industry            TEXT,
    country             TEXT,           -- 2-letter ISO 3166-1
    exchange            TEXT,
    currency            TEXT,
    tier                TEXT,           -- us_large, us_mid, us_small, us_micro, uk, eu, watchlist
    data_source         TEXT,           -- lse, yfinance, both
    fundamentals_source TEXT,           -- lse, yfinance, fmp
    is_active           BOOLEAN         DEFAULT true,
    added_at            TIMESTAMPTZ     DEFAULT now(),
    updated_at          TIMESTAMPTZ     DEFAULT now()
);

-- ==========================================================================
-- 2. prices_daily — end-of-day OHLCV bars
-- ==========================================================================
CREATE TABLE prices_daily (
    symbol      TEXT    NOT NULL,
    date        DATE    NOT NULL,
    open        REAL,
    high        REAL,
    low         REAL,
    close       REAL,
    adj_close   REAL,
    volume      BIGINT,
    source      TEXT,               -- lse, yfinance
    PRIMARY KEY (symbol, date)
);

-- ==========================================================================
-- 3. fundamentals_snapshot — latest screener metrics (50+ fields)
-- ==========================================================================
CREATE TABLE fundamentals_snapshot (
    symbol                  TEXT        PRIMARY KEY,

    -- Price & market
    price                   REAL,
    market_cap              REAL,
    beta                    REAL,
    volume                  BIGINT,
    average_volume          BIGINT,
    week_52_low             REAL,
    week_52_high            REAL,

    -- Valuation
    pe_ratio                REAL,
    pb_ratio                REAL,
    ps_ratio                REAL,
    p_fcf_ratio             REAL,
    ev_ebitda               REAL,
    ev_sales                REAL,
    earnings_yield          REAL,
    fcf_yield               REAL,

    -- Dividends
    dividend_yield          REAL,
    dividend_payout_ratio   REAL,
    dividend_per_share      REAL,

    -- Margins
    gross_margin            REAL,
    operating_margin        REAL,
    net_margin              REAL,

    -- Returns
    roe                     REAL,
    roa                     REAL,
    roic                    REAL,

    -- Liquidity / leverage
    current_ratio           REAL,
    quick_ratio             REAL,
    cash_ratio              REAL,
    debt_to_equity          REAL,
    debt_to_assets          REAL,

    -- Income statement
    revenue                 REAL,
    gross_profit            REAL,
    operating_income        REAL,
    net_income              REAL,
    ebitda                  REAL,
    eps                     REAL,
    eps_diluted             REAL,

    -- Growth
    revenue_growth_1y       REAL,
    revenue_growth_3y       REAL,
    revenue_growth_5y       REAL,
    net_income_growth_1y    REAL,
    net_income_growth_3y    REAL,
    net_income_growth_5y    REAL,
    eps_growth_1y           REAL,
    dividend_growth_1y      REAL,
    book_value_growth_1y    REAL,

    -- Meta
    ratios_date             DATE,
    source                  TEXT,
    updated_at              TIMESTAMPTZ     DEFAULT now()
);

-- ==========================================================================
-- 4. trend_radar — computed daily signals
-- ==========================================================================
CREATE TABLE trend_radar (
    symbol              TEXT        PRIMARY KEY,
    state               SMALLINT,       -- 1=GREEN, 0=GREY, -1=RED
    quality_rank        SMALLINT,       -- 0-100
    z_mom               REAL,
    f_ewmac             REAL,
    z_52                REAL,
    breakout_active     BOOLEAN,
    volume_confirmed    BOOLEAN,
    convergence_count   SMALLINT,
    daily_state         SMALLINT,
    weekly_state        SMALLINT,
    state_changed_at    DATE,
    computed_at         TIMESTAMPTZ     DEFAULT now()
);

-- ==========================================================================
-- 5. pharma_trials — clinical trial pipeline (ClinicalTrials.gov)
-- ==========================================================================
CREATE TABLE pharma_trials (
    nct_id              TEXT        PRIMARY KEY,
    ticker              TEXT,
    drug_name           TEXT,
    condition           TEXT,
    phase               TEXT,
    overall_status      TEXT,
    lead_sponsor        TEXT,
    start_date          DATE,
    completion_date     DATE,
    results_posted      BOOLEAN,
    primary_endpoint_met BOOLEAN,       -- nullable
    last_status_change  DATE,
    updated_at          TIMESTAMPTZ     DEFAULT now()
);

-- ==========================================================================
-- 6. pharma_signals — trading signals from pharma events
-- ==========================================================================
CREATE TABLE pharma_signals (
    id                  BIGSERIAL   PRIMARY KEY,
    ticker              TEXT,
    nct_id              TEXT        REFERENCES pharma_trials(nct_id),
    event_type          TEXT,
    direction           TEXT,           -- LONG / SHORT / WATCH
    phase               TEXT,
    confidence          SMALLINT,
    days_to_catalyst    INTEGER,
    detected_at         TIMESTAMPTZ,
    price_at_signal     REAL,
    return_1d           REAL,
    return_5d           REAL,
    return_20d          REAL
);

-- ==========================================================================
-- 7. pdufa_calendar — FDA action dates
-- ==========================================================================
CREATE TABLE pdufa_calendar (
    id                  SERIAL      PRIMARY KEY,
    ticker              TEXT,
    drug_name           TEXT,
    pdufa_date          DATE,
    application_type    TEXT,
    decision            TEXT,
    source              TEXT,
    confirmed           BOOLEAN     DEFAULT false,
    updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ==========================================================================
-- 8. sponsor_ticker_map — map ClinicalTrials sponsor names to tickers
-- ==========================================================================
CREATE TABLE sponsor_ticker_map (
    sponsor_name        TEXT        PRIMARY KEY,
    ticker              TEXT,
    exchange            TEXT,
    aliases             TEXT[],
    verified            BOOLEAN     DEFAULT false
);

-- ==========================================================================
-- 9. earnings_calendar — earnings dates + surprise data
-- ==========================================================================
CREATE TABLE earnings_calendar (
    ticker              TEXT        NOT NULL,
    event_date          DATE        NOT NULL,
    confirmed           BOOLEAN,
    source              TEXT,
    eps_est             REAL,
    eps_actual          REAL,
    surprise_pct        REAL,
    revenue_est         BIGINT,
    revenue_actual      BIGINT,
    radar_state_at_event SMALLINT,
    PRIMARY KEY (ticker, event_date)
);

-- ==========================================================================
-- 10. news_items — 30-day hot window of headlines
-- ==========================================================================
CREATE TABLE news_items (
    id                  BIGSERIAL   PRIMARY KEY,
    ticker              TEXT,
    published_at        TIMESTAMPTZ,
    source              TEXT,
    headline            VARCHAR(200),
    url                 TEXT,
    tone                REAL,
    abnormal_vol_z      REAL,
    badge               TEXT            -- nullable: FDA, RECALL, AE-SPIKE, etc.
);

-- ==========================================================================
-- 11. daily_brief — AI-generated morning brief
-- ==========================================================================
CREATE TABLE daily_brief (
    asof_date           DATE        PRIMARY KEY,
    brief               TEXT,
    inputs              JSONB,
    model               TEXT
);

-- ==========================================================================
-- 12. insider_trades_snapshot — cached from LSE API
-- ==========================================================================
CREATE TABLE insider_trades_snapshot (
    id                      BIGSERIAL       PRIMARY KEY,
    symbol                  TEXT,
    filing_date             DATE,
    transaction_date        DATE,
    transaction_type        TEXT,
    reporting_name          TEXT,
    type_of_owner           TEXT,
    securities_transacted   REAL,
    price                   REAL,
    form_type               TEXT,
    created_at              TIMESTAMPTZ     DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_prices_daily_symbol
    ON prices_daily (symbol);

CREATE INDEX idx_trend_radar_state
    ON trend_radar (state);

CREATE INDEX idx_pharma_trials_ticker
    ON pharma_trials (ticker);

CREATE INDEX idx_pharma_signals_ticker
    ON pharma_signals (ticker);

CREATE INDEX idx_earnings_calendar_event_date
    ON earnings_calendar (event_date);

CREATE INDEX idx_news_items_ticker_published
    ON news_items (ticker, published_at);

CREATE INDEX idx_insider_trades_symbol_filing
    ON insider_trades_snapshot (symbol, filing_date);
