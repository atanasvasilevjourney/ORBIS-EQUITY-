-- Fix XS paper writes when 033 was applied without service_role policies.

DROP POLICY IF EXISTS paper_loop_xs_runs_service ON paper_loop_xs_runs;
CREATE POLICY paper_loop_xs_runs_service ON paper_loop_xs_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS paper_book_xs_service ON paper_book_xs;
CREATE POLICY paper_book_xs_service ON paper_book_xs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS paper_orders_xs_service ON paper_orders_xs;
CREATE POLICY paper_orders_xs_service ON paper_orders_xs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
