/**
 * Database access. Two interchangeable backends behind ONE async API:
 *   - Cloudflare D1 over its REST API   (when CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_D1_DATABASE_ID + CLOUDFLARE_API_TOKEN are set)
 *   - local SQLite file via better-sqlite3 or Node's built-in node:sqlite (development / tests / seeding)
 * D1 has no interactive transactions, so multi-statement atomic work uses db.batch([...]) (atomic on both backends).
 */
import fs from "fs";
import path from "path";

type P = string | number | null | undefined | boolean | bigint;
export type RunResult = { changes: number; lastInsertRowid: number };
export type Stmt = { sql: string; params: P[] };
export const st = (sql: string, ...params: P[]): Stmt => ({ sql, params });
const norm = (p: P[]) => p.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "bigint" ? Number(v) : v));

interface Backend {
  all(sql: string, p: P[]): Promise<Record<string, unknown>[]>;
  run(sql: string, p: P[]): Promise<RunResult>;
  batch(stmts: Stmt[]): Promise<RunResult[]>;
  exec(sql: string): Promise<void>;
}

/* ---------------- Cloudflare D1 (REST) ---------------- */
function d1Backend(): Backend {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID!, dbid = process.env.CLOUDFLARE_D1_DATABASE_ID!, token = process.env.CLOUDFLARE_API_TOKEN!;
  const url = `${process.env.CLOUDFLARE_API_BASE || "https://api.cloudflare.com/client/v4"}/accounts/${acct}/d1/database/${dbid}/query`;
  type R = { results?: Record<string, unknown>[]; meta?: { changes?: number; last_row_id?: number } };
  async function call(body: unknown): Promise<R[]> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
        const j = (await r.json()) as { success: boolean; errors?: { message: string }[]; result?: R[] };
        if (!r.ok || !j.success) {
          const msg = j.errors?.map((e) => e.message).join("; ") || `HTTP ${r.status}`;
          if (r.status >= 500 || r.status === 429) { lastErr = new Error("D1: " + msg); await new Promise((x) => setTimeout(x, 300 * (attempt + 1))); continue; }
          throw new Error("D1: " + msg);
        }
        return j.result ?? [];
      } catch (e) { lastErr = e; if (!(e instanceof TypeError)) throw e; await new Promise((x) => setTimeout(x, 300 * (attempt + 1))); }
    }
    throw lastErr;
  }
  const meta = (r: R): RunResult => ({ changes: r.meta?.changes ?? 0, lastInsertRowid: r.meta?.last_row_id ?? 0 });
  return {
    async all(sql, p) { return (await call({ sql, params: norm(p) }))[0]?.results ?? []; },
    async run(sql, p) { return meta((await call({ sql, params: norm(p) }))[0] ?? {}); },
    async batch(stmts) { if (!stmts.length) return []; return (await call({ batch: stmts.map((s) => ({ sql: s.sql, params: norm(s.params) })) })).map(meta); },
    async exec(sql) { for (const s of splitSql(sql)) await call({ sql: s }); },
  };
}

/* ---------------- local SQLite ---------------- */
type Raw = {
  all(sql: string, p: P[]): Record<string, unknown>[];
  run(sql: string, p: P[]): RunResult;
  exec(sql: string): void;
  tx<T>(fn: () => T): T;
};

/**
 * Opens the local SQLite file with whichever driver works:
 *   1. better-sqlite3 (a native add-on: on Windows with a brand-new Node it may have no ready-made build and
 *      would need Visual Studio's C++ tools, so it is an *optional* dependency)
 *   2. Node's built-in SQLite (node:sqlite, Node 22.5+ including 24) - nothing to compile.
 * Set SQLITE_DRIVER=node or SQLITE_DRIVER=better-sqlite3 to force one.
 */
function openRaw(file: string): Raw {
  const forced = process.env.SQLITE_DRIVER;
  if (forced !== "node") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require("better-sqlite3") as typeof import("better-sqlite3");
      const raw = new Database(file);
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      return {
        all: (sql, p) => raw.prepare(sql).all(...norm(p)) as Record<string, unknown>[],
        run: (sql, p) => { const r = raw.prepare(sql).run(...norm(p)); return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) }; },
        exec: (sql) => { raw.exec(sql); },
        tx: (fn) => raw.transaction(fn)(),
      };
    } catch (e) {
      if (forced === "better-sqlite3") throw e;
    }
  }
  // getBuiltinModule keeps the bundler from trying to resolve the node: scheme at build time.
  const mod = (process as unknown as { getBuiltinModule?: (id: string) => typeof import("node:sqlite") | undefined }).getBuiltinModule?.("node:sqlite");
  if (!mod) throw new Error("No local SQLite driver: use Node 22.5 or newer (built-in SQLite), or install better-sqlite3.");
  const raw = new mod.DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return {
    all: (sql, p) => (raw.prepare(sql).all(...norm(p)) as Record<string, unknown>[]).map((r) => ({ ...r })),
    run: (sql, p) => { const r = raw.prepare(sql).run(...norm(p)); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
    exec: (sql) => { raw.exec(sql); },
    tx: (fn) => {
      raw.exec("BEGIN");
      try { const r = fn(); raw.exec("COMMIT"); return r; } catch (e) { raw.exec("ROLLBACK"); throw e; }
    },
  };
}

function sqliteBackend(): Backend {
  const file = process.env.DATABASE_FILE || path.join(process.cwd(), "data", "homestay.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = openRaw(file);
  return {
    async all(sql, p) { return raw.all(sql, p); },
    async run(sql, p) { return raw.run(sql, p); },
    async batch(stmts) { return raw.tx(() => stmts.map((s) => raw.run(s.sql, s.params))); },
    async exec(sql) { raw.exec(sql); },
  };
}

export const splitSql = (sql: string) => sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
export const usingD1 = !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_D1_DATABASE_ID && process.env.CLOUDFLARE_API_TOKEN);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', -- owner | manager | staff
  failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  totp_secret_enc TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, backup_codes TEXT, last_totp_step INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL, ip TEXT, user_agent TEXT, revoked INTEGER NOT NULL DEFAULT 0,
  mfa_ok INTEGER NOT NULL DEFAULT 0
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
  payment_hold_hours: "24", // unpaid pending bookings are released after this many hours
  data_retention_years: "8",
  grievance_officer_name: "",
  grievance_officer_email: "",
  notice_version: "1.0",
  total_rooms_note: "",
};


const g = globalThis as unknown as { __be?: Backend; __ready?: Promise<void> };
const be: Backend = g.__be ?? (g.__be = usingD1 ? d1Backend() : sqliteBackend());

/** Create tables + default settings. Local SQLite: automatic on first use. D1: run `npm run db:migrate` (never at request time). */
export async function migrate() {
  await be.exec(SCHEMA);
  await be.batch(Object.entries(DEFAULT_SETTINGS).map(([k, v]) => st("INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)", k, v)));
}
if (!g.__ready) g.__ready = usingD1 ? Promise.resolve() : migrate();
const ready = () => g.__ready!;

export const db = {
  prepare(sql: string) {
    return {
      async get<T = any>(...p: P[]): Promise<T | undefined> { await ready(); return (await be.all(sql, p))[0] as T | undefined; }, // eslint-disable-line @typescript-eslint/no-explicit-any
      async all<T = any>(...p: P[]): Promise<T[]> { await ready(); return (await be.all(sql, p)) as T[]; }, // eslint-disable-line @typescript-eslint/no-explicit-any
      async run(...p: P[]): Promise<RunResult> { await ready(); return be.run(sql, p); },
    };
  },
  async batch(stmts: Stmt[]) { await ready(); return be.batch(stmts); },
};

export async function getSetting(key: string): Promise<string> {
  const r = await db.prepare("SELECT value FROM settings WHERE key=?").get<{ value: string }>(key);
  return r?.value ?? DEFAULT_SETTINGS[key] ?? "";
}
export async function setSetting(key: string, value: string) {
  await db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
export async function allSettings(): Promise<Record<string, string>> {
  const rows = await db.prepare("SELECT key,value FROM settings").all<{ key: string; value: string }>();
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}
