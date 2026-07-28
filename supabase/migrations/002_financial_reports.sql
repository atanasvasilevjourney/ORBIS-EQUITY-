-- ============================================================================
-- KovaView Terminal — Migration 002: Financial Reports + F-Score
-- Adds financial_reports table for LSE z_financial_reports data
-- and f_score column to fundamentals_snapshot
-- ============================================================================

-- ==========================================================================
-- 1. financial_reports — historical income/balance/cashflow/metrics
-- ==========================================================================
CREATE TABLE financial_reports (
    symbol          TEXT        NOT NULL,
    report_type     TEXT        NOT NULL,   -- income, balance, cashflow, growth, metrics
    date            DATE        NOT NULL,
    period          TEXT        NOT NULL,   -- FY, Q1, Q2, Q3, Q4
    fiscal_year     TEXT,
    reported_currency TEXT,
    cik             TEXT,
    filing_date     DATE,
    data            JSONB       NOT NULL,   -- full financial data blob
    created_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (symbol, report_type, date, period)
);

CREATE INDEX idx_financial_reports_symbol
    ON financial_reports (symbol);

CREATE INDEX idx_financial_reports_type_date
    ON financial_reports (report_type, date DESC);

-- ==========================================================================
-- 2. Add f_score to fundamentals_snapshot
-- ==========================================================================
ALTER TABLE fundamentals_snapshot
    ADD COLUMN IF NOT EXISTS f_score SMALLINT;
