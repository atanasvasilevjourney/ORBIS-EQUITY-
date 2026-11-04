-- LOOP fresh book reset: close open paper_book rows, $100k cash, journal epoch.
-- Run in Supabase SQL Editor as postgres / service role (bypasses RLS).
-- Then on Render (service_role): python -m pipeline.compute.sync_loop_journal

DO $$
DECLARE
  session_day date := (now() AT TIME ZONE 'America/New_York')::date;
  run_id text := 'run_' || to_char(session_day, 'YYYY-MM-DD') || '_reset_manual';
  pos record;
  ord_n int := 0;
BEGIN
  FOR pos IN SELECT symbol, shares, last, entry, sector FROM paper_book LOOP
    ord_n := ord_n + 1;
    INSERT INTO paper_orders (
      id, run_id, ticker, action, type, shares, limit_price, reason, sector, risk_usd, created_at
    ) VALUES (
      run_id || '_ord_' || lpad(ord_n::text, 3, '0'),
      run_id,
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

  INSERT INTO paper_loop_runs (
    run_id, asof_date, equity, deployed_pct, open_risk_pct, names, posture,
    status, headline, harness, log, computed_at
  ) VALUES (
    run_id,
    session_day,
    100000,
    0,
    0,
    0,
    50,
    'OK',
    'Reset to $100,000 · ' || ord_n || ' closed · waiting for ' || session_day || ' open',
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
        'message', 'Manual fresh book reset · $100,000 cash · ' || ord_n || ' exit order(s)'
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
END $$;
