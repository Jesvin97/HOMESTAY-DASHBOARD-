import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { db } from "./db";
import { encrypt, decrypt } from "./crypto";
import { verifyTotp, consumeBackupCode, newSecret, newBackupCodes, otpauthUri } from "./mfa";
import { getSetting } from "./db";

export const COOKIE = "hs_session";
export type Role = "owner" | "manager" | "staff";
export type User = { id: number; email: string; name: string; role: Role; must_change_password: number; totp_enabled: number };

const IDLE_MS = Number(process.env.IDLE_TIMEOUT_MIN || 15) * 60_000;
const ABS_MS = Number(process.env.ABSOLUTE_TIMEOUT_HOURS || 8) * 3_600_000;
const MAX_FAILS = 5;
export const MFA_REQUIRED = process.env.MFA_REQUIRED !== "false"; // default: everyone must use an authenticator app
const LOCK_MS = 15 * 60_000;
export const idleTimeoutMs = IDLE_MS;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
    return new TextEncoder().encode("dev-only-secret-dev-only-secret-dev");
  }
  return new TextEncoder().encode(s);
}
const nowIso = () => new Date().toISOString();

export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return "Password must be at least 12 characters.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return "Use upper-case, lower-case and a digit.";
  return null;
}

export async function clientInfo() {
  const h = await headers();
  return { ip: (h.get("x-forwarded-for") || "unknown").split(",")[0].trim(), ua: h.get("user-agent") || "" };
}

export async function audit(user: { id: number; email: string } | null, action: string, entity?: string, entityId?: string | number, detail?: unknown, ip?: string) {
  await db.prepare("INSERT INTO audit_log(user_id,user_email,action,entity,entity_id,detail,ip) VALUES (?,?,?,?,?,?,?)").run(
    user?.id ?? null, user?.email ?? null, action, entity ?? null, entityId != null ? String(entityId) : null,
    detail === undefined ? null : typeof detail === "string" ? detail : JSON.stringify(detail), ip ?? null,
  );
}

// in-memory per-IP throttle (per process) on top of per-account lockout
const ipHits = new Map<string, number[]>();
function ipThrottled(ip: string) {
  const t = Date.now();
  const arr = (ipHits.get(ip) || []).filter((x) => t - x < 10 * 60_000);
  arr.push(t);
  ipHits.set(ip, arr);
  return arr.length > 20;
}

export async function login(email: string, password: string): Promise<{ error?: string }> {
  const { ip, ua } = await clientInfo();
  if (ipThrottled(ip)) return { error: "Too many attempts. Try again later." };
  const u = await db.prepare("SELECT * FROM users WHERE email=? AND active=1").get(email.trim().toLowerCase()) as
    | (User & { password_hash: string; failed_attempts: number; locked_until: string | null })
    | undefined;
  const generic = { error: "Invalid email or password." };
  if (!u) {
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi"); // timing
    await audit(null, "login_failed", "user", email, { reason: "unknown" }, ip);
    return generic;
  }
  if (u.locked_until && Date.parse(u.locked_until) > Date.now()) {
    await audit(u, "login_blocked_locked", "user", u.id, undefined, ip);
    return { error: "Account temporarily locked after repeated failures. Try again in 15 minutes." };
  }
  if (!(await bcrypt.compare(password, u.password_hash))) {
    const fails = u.failed_attempts + 1;
    const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    await db.prepare("UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?").run(lock ? 0 : fails, lock, u.id);
    await audit(u, lock ? "account_locked" : "login_failed", "user", u.id, undefined, ip);
    return generic;
  }
  await db.prepare("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?").run(u.id);
  const sid = crypto.randomBytes(32).toString("hex");
  const mfaOk = !MFA_REQUIRED && !(u as unknown as { totp_enabled: number }).totp_enabled ? 1 : 0;
  await db.prepare("INSERT INTO sessions(id,user_id,created_at,last_seen,ip,user_agent,mfa_ok) VALUES (?,?,?,?,?,?,?)").run(sid, u.id, nowIso(), nowIso(), ip, ua.slice(0, 200), mfaOk);
  const jwt = await new SignJWT({ sid }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(Math.floor((Date.now() + ABS_MS) / 1000)).sign(secret());
  (await cookies()).set(COOKIE, jwt, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ABS_MS / 1000 });
  await audit(u, mfaOk ? "login" : "login_password_ok_mfa_pending", "user", u.id, undefined, ip);
  return {};
}

export async function logout() {
  const jar = await cookies();
  const tok = jar.get(COOKIE)?.value;
  if (tok) {
    try {
      const { payload } = await jwtVerify(tok, secret());
      await db.prepare("UPDATE sessions SET revoked=1 WHERE id=?").run(payload.sid as string);
    } catch {}
  }
  jar.delete(COOKIE);
}

type Loaded = { user: User; sid: string; mfaOk: boolean };
async function loadSession(touch: boolean): Promise<Loaded | null> {
  const tok = (await cookies()).get(COOKIE)?.value;
  if (!tok) return null;
  let sid: string;
  try { sid = (await jwtVerify(tok, secret())).payload.sid as string; } catch { return null; }
  const s = await db.prepare("SELECT * FROM sessions WHERE id=?").get<{ user_id: number; created_at: string; last_seen: string; revoked: number; mfa_ok: number }>(sid);
  if (!s || s.revoked) return null;
  const t = Date.now();
  if (t - Date.parse(s.last_seen) > IDLE_MS || t - Date.parse(s.created_at) > ABS_MS) {
    await db.prepare("UPDATE sessions SET revoked=1 WHERE id=?").run(sid);
    return null;
  }
  if (touch) await db.prepare("UPDATE sessions SET last_seen=? WHERE id=?").run(nowIso(), sid);
  const user = await db.prepare("SELECT id,email,name,role,must_change_password,totp_enabled FROM users WHERE id=? AND active=1").get<User>(s.user_id);
  return user ? { user, sid, mfaOk: !!s.mfa_ok } : null;
}

/** The fully signed-in user (password AND second factor done), or null. Enforces idle + absolute timeout and server-side revocation. */
export async function getUser(touch = true): Promise<User | null> {
  const l = await loadSession(touch);
  return l && l.mfaOk ? l.user : null;
}
/** Password accepted but second factor still outstanding. */
export async function getPendingUser(): Promise<User | null> {
  const l = await loadSession(true);
  return l && !l.mfaOk ? l.user : null;
}

export async function requireUser(minRole: Role = "staff"): Promise<User> {
  const u = await getUser();
  if (!u) redirect((await getPendingUser()) ? "/mfa" : "/login");
  const rank = { staff: 0, manager: 1, owner: 2 } as const;
  if (rank[u.role] < rank[minRole]) redirect("/?denied=1");
  return u;
}
export const can = (u: User, min: Role) => ({ staff: 0, manager: 1, owner: 2 })[u.role] >= ({ staff: 0, manager: 1, owner: 2 })[min];

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

/* ---------------- MFA ---------------- */
type MfaRow = { totp_secret_enc: string | null; totp_enabled: number; backup_codes: string | null; last_totp_step: number; failed_attempts: number };
const mfaRow = (id: number) => db.prepare("SELECT totp_secret_enc,totp_enabled,backup_codes,last_totp_step,failed_attempts FROM users WHERE id=?").get<MfaRow>(id);

async function mfaFailure(u: User, sid: string, ip: string) {
  const r = (await mfaRow(u.id))!;
  const fails = r.failed_attempts + 1;
  if (fails >= MAX_FAILS) {
    await db.prepare("UPDATE users SET failed_attempts=0, locked_until=? WHERE id=?").run(new Date(Date.now() + LOCK_MS).toISOString(), u.id);
    await db.prepare("UPDATE sessions SET revoked=1 WHERE user_id=?").run(u.id);
    await audit(u, "mfa_locked", "user", u.id, undefined, ip);
  } else await db.prepare("UPDATE users SET failed_attempts=? WHERE id=?").run(fails, u.id);
  await audit(u, "mfa_failed", "user", u.id, undefined, ip);
}
async function mfaSuccess(u: User, sid: string, ip: string, how: string) {
  await db.prepare("UPDATE sessions SET mfa_ok=1, last_seen=? WHERE id=?").run(nowIso(), sid);
  await db.prepare("UPDATE users SET failed_attempts=0 WHERE id=?").run(u.id);
  await audit(u, "login", "user", u.id, { mfa: how }, ip);
}

/** Second step of login: 6-digit app code, or a single-use backup code. */
export async function verifyMfaLogin(input: string): Promise<{ ok?: true; error?: string; backupLeft?: number }> {
  const l = await loadSession(true);
  if (!l) return { error: "Session expired — sign in again." };
  if (l.mfaOk) return { ok: true };
  const { ip } = await clientInfo();
  const r = await mfaRow(l.user.id);
  if (!r?.totp_enabled || !r.totp_secret_enc) return { error: "Authenticator isn't set up yet." };
  const step = verifyTotp(decrypt(r.totp_secret_enc), input, r.last_totp_step);
  if (step) {
    await db.prepare("UPDATE users SET last_totp_step=? WHERE id=?").run(step, l.user.id);
    await mfaSuccess(l.user, l.sid, ip, "totp");
    return { ok: true };
  }
  const left = r.backup_codes ? consumeBackupCode(JSON.parse(r.backup_codes) as string[], input) : null;
  if (left) {
    await db.prepare("UPDATE users SET backup_codes=? WHERE id=?").run(JSON.stringify(left), l.user.id);
    await mfaSuccess(l.user, l.sid, ip, "backup_code");
    return { ok: true, backupLeft: left.length };
  }
  await mfaFailure(l.user, l.sid, ip);
  return { error: "That code isn't right. Codes change every 30 seconds." };
}

/** Enrolment: create (or reuse) a pending secret. Not active until the user proves they can generate a code. */
export async function beginMfaEnrollment(u: User) {
  const r = await mfaRow(u.id);
  let secretPlain: string;
  if (r?.totp_secret_enc && !r.totp_enabled) secretPlain = decrypt(r.totp_secret_enc);
  else { secretPlain = newSecret(); await db.prepare("UPDATE users SET totp_secret_enc=?, totp_enabled=0 WHERE id=?").run(encrypt(secretPlain), u.id); }
  return { secret: secretPlain, uri: otpauthUri(u.email, secretPlain, await getSetting("property_name")) };
}
export async function confirmMfaEnrollment(input: string): Promise<{ ok?: true; error?: string; backupCodes?: string[] }> {
  const l = await loadSession(true);
  if (!l) return { error: "Session expired — sign in again." };
  const r = await mfaRow(l.user.id);
  if (!r?.totp_secret_enc || r.totp_enabled) return { error: "Nothing to confirm." };
  const step = verifyTotp(decrypt(r.totp_secret_enc), input, 0);
  const { ip } = await clientInfo();
  if (!step) { await mfaFailure(l.user, l.sid, ip); return { error: "Code didn't match. Check the phone's clock is automatic and try the next code." }; }
  const { plain, hashed } = newBackupCodes();
  await db.prepare("UPDATE users SET totp_enabled=1, last_totp_step=?, backup_codes=? WHERE id=?").run(step, JSON.stringify(hashed), l.user.id);
  await db.prepare("UPDATE sessions SET mfa_ok=1 WHERE id=?").run(l.sid);
  await audit(l.user, "mfa_enrolled", "user", l.user.id, undefined, ip);
  return { ok: true, backupCodes: plain };
}
/** Fresh backup codes — requires a current authenticator code. */
export async function regenerateBackupCodes(u: User, input: string): Promise<{ codes?: string[]; error?: string }> {
  const r = await mfaRow(u.id);
  if (!r?.totp_enabled || !r.totp_secret_enc) return { error: "MFA isn't enabled." };
  const step = verifyTotp(decrypt(r.totp_secret_enc), input, r.last_totp_step);
  if (!step) return { error: "Wrong code." };
  const { plain, hashed } = newBackupCodes();
  await db.prepare("UPDATE users SET backup_codes=?, last_totp_step=? WHERE id=?").run(JSON.stringify(hashed), step, u.id);
  await audit(u, "mfa_backup_codes_regenerated", "user", u.id);
  return { codes: plain };
}
/** Lost phone + lost backup codes: owner resets another user; they re-enrol at next sign-in. */
export async function resetMfa(admin: User, userId: number) {
  await db.prepare("UPDATE users SET totp_secret_enc=NULL, totp_enabled=0, backup_codes=NULL, last_totp_step=0 WHERE id=?").run(userId);
  await db.prepare("UPDATE sessions SET revoked=1 WHERE user_id=?").run(userId);
  await audit(admin, "mfa_reset", "user", userId);
}
