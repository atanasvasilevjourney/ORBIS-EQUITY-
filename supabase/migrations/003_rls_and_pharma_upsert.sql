-- ============================================================================
-- KovaView Terminal — Migration 003: RLS Policies + Pharma Signal Upsert
-- Enables Row-Level Security on all tables with read-only anon access.
-- Adds unique constraint on pharma_signals.nct_id for atomic upserts.
-- ============================================================================

-- ==========================================================================
-- 1. Enable RLS on all tables
-- ==========================================================================
ALTER TABLE universe_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE fundamentals_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE trend_radar ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharma_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharma_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdufa_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_ticker_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_brief ENABLE ROW LEVEL SECURITY;
ALTER TABLE insider_trades_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_reports ENABLE ROW LEVEL SECURITY;

-- ==========================================================================
-- 2. Read-only SELECT policies for anon role (browser client)
-- ==========================================================================
CREATE POLICY "anon_read" ON universe_members FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON prices_daily FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON fundamentals_snapshot FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON trend_radar FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON pharma_trials FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON pharma_signals FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON pdufa_calendar FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON sponsor_ticker_map FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON earnings_calendar FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON news_items FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON daily_brief FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON insider_trades_snapshot FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON financial_reports FOR SELECT TO anon USING (true);

-- ==========================================================================
-- 3. Full access for service_role (pipeline / API routes)
-- ==========================================================================
CREATE POLICY "service_all" ON universe_members FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON prices_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON fundamentals_snapshot FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON trend_radar FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON pharma_trials FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON pharma_signals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON pdufa_calendar FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON sponsor_ticker_map FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON earnings_calendar FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON news_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON daily_brief FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON insider_trades_snapshot FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON financial_reports FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==========================================================================
-- 4. Unique constraint on pharma_signals.nct_id for atomic upserts
-- ==========================================================================
ALTER TABLE pharma_signals ADD CONSTRAINT uq_pharma_signals_nct_id UNIQUE (nct_id);

-- ==========================================================================
-- 5. Unique constraint on news_items for deduplication
-- ==========================================================================
ALTER TABLE news_items ADD CONSTRAINT uq_news_items_ticker_url UNIQUE (ticker, url);

-- ==========================================================================
-- 6. Unique constraint on insider_trades_snapshot for upsert
-- ==========================================================================
ALTER TABLE insider_trades_snapshot
    ADD CONSTRAINT uq_insider_symbol_filing_name
    UNIQUE (symbol, filing_date, reporting_name);

-- ==========================================================================
-- 7. Missing indexes for common query patterns
-- ==========================================================================
CREATE INDEX IF NOT EXISTS idx_fundamentals_sector
    ON fundamentals_snapshot (f_score);

CREATE INDEX IF NOT EXISTS idx_pdufa_ticker
    ON pdufa_calendar (ticker);

CREATE INDEX IF NOT EXISTS idx_pdufa_date
    ON pdufa_calendar (pdufa_date);
