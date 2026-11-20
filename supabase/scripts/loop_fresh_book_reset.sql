-- LOOP fresh book reset: close open paper_book rows, $100k cash, journal epoch.
-- Run in Supabase SQL Editor as postgres / service role (bypasses RLS).
-- Then on Render (service_role): python -m pipeline.compute.sync_loop_journal
--
-- Do NOT run restore_loop_book / restore_loop_book_2026-10-13.sql after this — that re-opens old names.

DO $reset$
DECLARE
  session_day date := (now() AT TIME ZONE 'America/New_York')::date;
  v_run_id text := 'run_' || to_char(session_day, 'YYYY-MM-DD') || '_reset_manual';
  pos record;
  ord_n int := 0;
  open_names int := 0;
BEGIN
  SELECT count(*)::int INTO open_names FROM paper_book;

  -- paper_orders.run_id FK → create the run row before any orders
  INSERT INTO paper_loop_runs (
    run_id, asof_date, equity, deployed_pct, open_risk_pct, names, posture,
    status, headline, harness, log, computed_at
  ) VALUES (
    v_run_id,
    session_day,
    100000,
    0,
    0,
    0,
    50,
    'OK',
    'Reset to $100,000 · ' || open_names || ' closed · waiting for ' || session_day || ' open',
    jsonb_build_object(
      'bookEpoch', to_char(session_day, 'YYYY-MM-DD'),
      'lastRebalanceDate', to_char(session_day, 'YYYY-MM-DD'),
      'sectorExposure', '[]'::jsonb,
      'skipped', '[]'::jsonb,
      'config', jsonb_build_object(
        'engine', 'donchian_vwap',
        'entryChannel', 55,
        'vwapWindow', 20,
        'maxNames', 8,
        'maxPerSector', 2,
        'rebalanceDays', 5,
        'equalWeight', true,
        'fill', 'session_open'
      )
    ),
    jsonb_build_array(
      jsonb_build_object(
        'at', now(),
        'level', 'INFO',
        'message', 'Manual fresh book reset · $100,000 cash · ' || open_names || ' exit order(s) pending'
      )
    ),
    now()
  )
  ON CONFLICT (run_id) DO UPDATE SET
    names = EXCLUDED.names,
    deployed_pct = EXCLUDED.deployed_pct,
    headline = EXCLUDED.headline,
    harness = EXCLUDED.harness,
    log = EXCLUDED.log,
    computed_at = EXCLUDED.computed_at;

  FOR pos IN SELECT symbol, shares, last, entry, sector FROM paper_book LOOP
    ord_n := ord_n + 1;
    INSERT INTO paper_orders (
      id, run_id, ticker, action, type, shares, limit_price, reason, sector, risk_usd, created_at
    ) VALUES (
      v_run_id || '_ord_' || lpad(ord_n::text, 3, '0'),
      v_run_id,
      pos.symbol,
      'SELL',
      'EXIT',
      pos.shares,
      COALESCE(pos.last, pos.entry),
      'Reset · flat book, new entries at the session open',
      COALESCE(pos.sector, ''),
      NULL,
      now()
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  DELETE FROM paper_book;

  IF ord_n <> open_names THEN
    RAISE WARNING 'Expected % open name(s), wrote % exit order(s)', open_names, ord_n;
  END IF;
END $reset$;
