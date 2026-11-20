import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const file = process.env.DATABASE_FILE || path.join(process.cwd(), "data", "homestay.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', -- owner | manager | staff
  failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL, ip TEXT, user_agent TEXT, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), user_id INTEGER, user_email TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 2,
  base_price INTEGER NOT NULL, description TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS room_rates (
  id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id), label TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, price INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS room_blocks (
  id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id), start_date TEXT NOT NULL,
  end_date TEXT NOT NULL, reason TEXT, source TEXT NOT NULL DEFAULT 'manual', external_uid TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY, room_id INTEGER REFERENCES rooms(id), url TEXT NOT NULL, caption TEXT,
  is_hero INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, phone TEXT, email TEXT,
  commission_pct REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'per person', included INTEGER NOT NULL DEFAULT 0,
  provider_id INTEGER REFERENCES providers(id), description TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT,
  aadhaar_enc TEXT, aadhaar_last4 TEXT, aadhaar_purpose TEXT, aadhaar_delete_after TEXT,
  consent_marketing INTEGER NOT NULL DEFAULT 0, consent_whatsapp INTEGER NOT NULL DEFAULT 0,
  loyalty_points INTEGER NOT NULL DEFAULT 0, unsub_token TEXT, notes TEXT,
  erased_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guest_phone ON guests(phone);
CREATE INDEX IF NOT EXISTS idx_guest_email ON guests(email);
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, description TEXT, type TEXT NOT NULL DEFAULT 'percent', -- percent | flat
  value INTEGER NOT NULL, max_discount INTEGER, min_nights INTEGER NOT NULL DEFAULT 1, min_amount INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT, valid_to TEXT, stay_from TEXT, stay_to TEXT, blackout_dates TEXT, room_types TEXT,
  max_uses INTEGER, used INTEGER NOT NULL DEFAULT 0, per_guest_once INTEGER NOT NULL DEFAULT 0,
  first_time_only INTEGER NOT NULL DEFAULT 0, weekdays_only INTEGER NOT NULL DEFAULT 0,
  terms TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, guest_id INTEGER NOT NULL REFERENCES guests(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id), check_in TEXT NOT NULL, check_out TEXT NOT NULL,
  adults INTEGER NOT NULL DEFAULT 2, children INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed', -- pending | confirmed | checked_in | completed | cancelled | no_show
  source TEXT NOT NULL DEFAULT 'direct', -- website | direct | airbnb | booking_com | makemytrip | phone
  room_amount INTEGER NOT NULL, services_amount INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0,
  loyalty_discount INTEGER NOT NULL DEFAULT 0, gst INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0, payment_method TEXT, coupon_code TEXT, notes TEXT,
  commission INTEGER NOT NULL DEFAULT 0,
  confirmation_status TEXT NOT NULL DEFAULT 'not_sent', -- not_sent | sent | failed | dry_run
  confirmation_sent_at TEXT, cancelled_at TEXT, cancel_reason TEXT, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_booking_dates ON bookings(room_id, check_in, check_out);
CREATE TABLE IF NOT EXISTS booking_services (
  id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id), service_id INTEGER NOT NULL REFERENCES services(id),
  qty INTEGER NOT NULL DEFAULT 1, price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id), amount INTEGER NOT NULL,
  upi_id TEXT, status TEXT NOT NULL DEFAULT 'proposed', -- proposed | approved | paid | failed | rejected
  policy_note TEXT, proposed_by INTEGER, approved_by INTEGER, provider_ref TEXT, failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY, direction TEXT NOT NULL, kind TEXT NOT NULL, booking_id INTEGER, guest_id INTEGER,
  from_addr TEXT, to_addr TEXT, subject TEXT, body TEXT, status TEXT NOT NULL, error TEXT, message_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY, guest_id INTEGER, booking_id INTEGER, subject TEXT NOT NULL, body TEXT,
  severity TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open', -- open | in_progress | resolved
  source TEXT NOT NULL DEFAULT 'manual', resolution TEXT, email_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT 'all_consented', status TEXT NOT NULL DEFAULT 'draft', -- draft | approved | sent
  created_by INTEGER, approved_by INTEGER, sent_count INTEGER NOT NULL DEFAULT 0, sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id INTEGER PRIMARY KEY, guest_id INTEGER NOT NULL REFERENCES guests(id), points INTEGER NOT NULL,
  reason TEXT NOT NULL, booking_id INTEGER, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY, guest_id INTEGER NOT NULL REFERENCES guests(id), booking_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | requested | received | rejected
  requested_at TEXT, token TEXT, rating INTEGER, text TEXT, publish INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY, guest_id INTEGER NOT NULL REFERENCES guests(id), purpose TEXT NOT NULL,
  granted INTEGER NOT NULL, source TEXT, notice_version TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS dsr_requests (
  id INTEGER PRIMARY KEY, guest_id INTEGER, requester TEXT, type TEXT NOT NULL, -- access | correction | erasure | withdraw_consent | grievance | nominate
  status TEXT NOT NULL DEFAULT 'open', due_date TEXT NOT NULL, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);
CREATE TABLE IF NOT EXISTS breaches (
  id INTEGER PRIMARY KEY, discovered_at TEXT NOT NULL, description TEXT NOT NULL, data_affected TEXT,
  people_affected INTEGER, authority_notified INTEGER NOT NULL DEFAULT 0, individuals_notified INTEGER NOT NULL DEFAULT 0,
  remediation TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, commission_pct REAL NOT NULL DEFAULT 0,
  room_id INTEGER REFERENCES rooms(id), ical_url TEXT, last_sync TEXT, last_result TEXT
);
`;

const DEFAULT_SETTINGS: Record<string, string> = {
  property_name: "Your Homestay",
  property_phone: "",
  property_email: "",
  gst_number: "",
  gst_mode: "slab", // slab | flat | none
  gst_flat_pct: "12",
  services_gst_pct: "18",
  cancellation_policy: JSON.stringify([
    { daysBefore: 7, refundPct: 100 },
    { daysBefore: 3, refundPct: 50 },
    { daysBefore: 0, refundPct: 0 },
  ]),
  loyalty_points_per_100: "5",
  loyalty_point_value: "1", // rupees per point on redemption
  loyalty_tiers: JSON.stringify([
    { name: "Member", minStays: 0 },
    { name: "Silver", minStays: 3 },
    { name: "Gold", minStays: 6 },
  ]),
  loyalty_welcome_bonus: "50",
  loyalty_review_bonus: "100",
  aadhaar_retention_days: "30",
  data_retention_years: "8",
  grievance_officer_name: "",
  grievance_officer_email: "",
  notice_version: "1.0",
  total_rooms_note: "",
};

type DB = Database.Database;
const g = globalThis as unknown as { __db?: DB };

function open(): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  const ins = db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)");
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  return db;
}

export const db: DB = g.__db ?? (g.__db = open());

export function getSetting(key: string): string {
  const r = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return r?.value ?? DEFAULT_SETTINGS[key] ?? "";
}
export function setSetting(key: string, value: string) {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
export function allSettings(): Record<string, string> {
  const rows = db.prepare("SELECT key,value FROM settings").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
