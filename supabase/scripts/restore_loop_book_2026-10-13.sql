-- Restore LOOP paper book: CRWD, PANW, A (opened 2026-09-28 session)
-- Run in Supabase SQL Editor (service role / postgres — bypasses RLS).
-- Cause: 2026-10-13 portfolio_loop rebalance with empty target rotated out all names.

BEGIN;

DELETE FROM paper_orders
WHERE run_id = 'run_2026-10-13_040311';

INSERT INTO paper_loop_runs (
  run_id, asof_date, equity, deployed_pct, open_risk_pct, names, posture,
  status, headline, harness, log, computed_at
) VALUES (
  'run_2026-10-13_restore_manual',
  '2026-10-13',
  100000,
  0.9980,
  0.9980,
  3,
  70,
  'OK',
  'Restored · 3 names · deployed 99.8% (undo empty rebalance)',
  jsonb_build_object(
    'lastRebalanceDate', '2026-09-28',
    'restoredFrom', 'run_2026-10-13_040311',
    'sectorExposure', '[]'::jsonb,
    'skipped', '[]'::jsonb
  ),
  jsonb_build_array(
    jsonb_build_object(
      'at', now(),
      'level', 'INFO',
      'message', 'Manual SQL restore: CRWD, PANW, A'
    )
  ),
  now()
)
ON CONFLICT (run_id) DO UPDATE SET
  names = EXCLUDED.names,
  deployed_pct = EXCLUDED.deployed_pct,
  open_risk_pct = EXCLUDED.open_risk_pct,
  headline = EXCLUDED.headline,
  harness = EXCLUDED.harness,
  log = EXCLUDED.log,
  computed_at = EXCLUDED.computed_at;

INSERT INTO paper_book (
  symbol, run_id, company_name, side, shares, entry, last, stop,
  n, risk_usd, sector, reason, rank, breakout, green,
  unrealized_pnl_usd, days_held, opened_at, updated_at
) VALUES
  (
    'CRWD', 'run_2026-10-13_restore_manual', 'CrowdStrike', 'LONG', 134,
    248.08, 263.01, 216.05,
    NULL, NULL, 'Information Technology',
    'DC55+VWAP20 · session open 248.08 · str 0.047',
    0, false, true, 2000.62, 15, '2026-09-28', now()
  ),
  (
    'PANW', 'run_2026-10-13_restore_manual', 'Palo Alto Networks', 'LONG', 90,
    370.27, 403.83, 340.25,
    NULL, NULL, 'Information Technology',
    'DC55+VWAP20 · session open 370.27 · str 0.025',
    0, false, true, 3020.40, 15, '2026-09-28', now()
  ),
  (
    'A', 'run_2026-10-13_restore_manual', 'Agilent Technologies', 'LONG', 193,
    171.98, 171.33, 144.65,
    NULL, NULL, 'Health Care',
    'DC55+VWAP20 · session open 171.98 · str 0.023',
    0, false, true, -125.45, 15, '2026-09-28', now()
  )
ON CONFLICT (symbol) DO UPDATE SET
  run_id = EXCLUDED.run_id,
  shares = EXCLUDED.shares,
  entry = EXCLUDED.entry,
  last = EXCLUDED.last,
  stop = EXCLUDED.stop,
  sector = EXCLUDED.sector,
  reason = EXCLUDED.reason,
  unrealized_pnl_usd = EXCLUDED.unrealized_pnl_usd,
  days_held = EXCLUDED.days_held,
  opened_at = EXCLUDED.opened_at,
  updated_at = EXCLUDED.updated_at;

COMMIT;
