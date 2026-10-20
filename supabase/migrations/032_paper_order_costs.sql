-- Paper LOOP order economics (commission + slippage per side).

ALTER TABLE paper_orders
    ADD COLUMN IF NOT EXISTS fill_price REAL,
    ADD COLUMN IF NOT EXISTS fill_mode TEXT,
    ADD COLUMN IF NOT EXISTS commission_usd REAL,
    ADD COLUMN IF NOT EXISTS slippage_usd REAL,
    ADD COLUMN IF NOT EXISTS cost_usd REAL;
