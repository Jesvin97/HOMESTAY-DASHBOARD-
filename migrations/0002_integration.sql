-- Website integration. `npm run db:migrate` applies all of this automatically and safely (it only adds what is missing).
-- Apply by hand ONLY on a database that does not have these columns yet, ONE statement at a time:
--   npx wrangler d1 execute <DB> --remote --file=migrations/0002_integration.sql
ALTER TABLE rooms ADD COLUMN slug TEXT;
ALTER TABLE rooms ADD COLUMN blocks_all INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN meals_extra INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN base_occupancy INTEGER NOT NULL DEFAULT 2;
ALTER TABLE services ADD COLUMN code TEXT;
ALTER TABLE bookings ADD COLUMN plan TEXT NOT NULL DEFAULT 'bb';
ALTER TABLE bookings ADD COLUMN hold_expires_at TEXT;
ALTER TABLE bookings ADD COLUMN provider_order_id TEXT;
ALTER TABLE bookings ADD COLUMN provider_payment_id TEXT;
ALTER TABLE bookings ADD COLUMN consent_at TEXT;
ALTER TABLE bookings ADD COLUMN consent_version TEXT;
ALTER TABLE bookings ADD COLUMN guest_details TEXT;
ALTER TABLE refunds ADD COLUMN percent INTEGER;
ALTER TABLE refunds ADD COLUMN method TEXT;
CREATE TABLE IF NOT EXISTS api_nonces (nonce TEXT PRIMARY KEY, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'callback', name TEXT, phone TEXT, note TEXT,
  consent_at TEXT, consent_version TEXT, status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_slug ON rooms(slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_code ON services(code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_order ON bookings(provider_order_id) WHERE provider_order_id IS NOT NULL;
