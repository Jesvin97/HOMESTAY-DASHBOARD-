import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { db } from "./db";

export const COOKIE = "hs_session";
export type Role = "owner" | "manager" | "staff";
export type User = { id: number; email: string; name: string; role: Role; must_change_password: number };

const IDLE_MS = Number(process.env.IDLE_TIMEOUT_MIN || 15) * 60_000;
const ABS_MS = Number(process.env.ABSOLUTE_TIMEOUT_HOURS || 8) * 3_600_000;
const MAX_FAILS = 5;
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

export function audit(user: { id: number; email: string } | null, action: string, entity?: string, entityId?: string | number, detail?: unknown, ip?: string) {
  db.prepare("INSERT INTO audit_log(user_id,user_email,action,entity,entity_id,detail,ip) VALUES (?,?,?,?,?,?,?)").run(
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
  const u = db.prepare("SELECT * FROM users WHERE email=? AND active=1").get(email.trim().toLowerCase()) as
    | (User & { password_hash: string; failed_attempts: number; locked_until: string | null })
    | undefined;
  const generic = { error: "Invalid email or password." };
  if (!u) {
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi"); // timing
    audit(null, "login_failed", "user", email, { reason: "unknown" }, ip);
    return generic;
  }
  if (u.locked_until && Date.parse(u.locked_until) > Date.now()) {
    audit(u, "login_blocked_locked", "user", u.id, undefined, ip);
    return { error: "Account temporarily locked after repeated failures. Try again in 15 minutes." };
  }
  if (!(await bcrypt.compare(password, u.password_hash))) {
    const fails = u.failed_attempts + 1;
    const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    db.prepare("UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?").run(lock ? 0 : fails, lock, u.id);
    audit(u, lock ? "account_locked" : "login_failed", "user", u.id, undefined, ip);
    return generic;
  }
  db.prepare("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?").run(u.id);
  const sid = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions(id,user_id,created_at,last_seen,ip,user_agent) VALUES (?,?,?,?,?,?)").run(sid, u.id, nowIso(), nowIso(), ip, ua.slice(0, 200));
  const jwt = await new SignJWT({ sid }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(Math.floor((Date.now() + ABS_MS) / 1000)).sign(secret());
  (await cookies()).set(COOKIE, jwt, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ABS_MS / 1000 });
  audit(u, "login", "user", u.id, undefined, ip);
  return {};
}

export async function logout() {
  const jar = await cookies();
  const tok = jar.get(COOKIE)?.value;
  if (tok) {
    try {
      const { payload } = await jwtVerify(tok, secret());
      db.prepare("UPDATE sessions SET revoked=1 WHERE id=?").run(payload.sid as string);
    } catch {}
  }
  jar.delete(COOKIE);
}

/** Returns the signed-in user or null. Enforces idle + absolute timeout and server-side revocation. */
export async function getUser(touch = true): Promise<User | null> {
  const tok = (await cookies()).get(COOKIE)?.value;
  if (!tok) return null;
  let sid: string;
  try { sid = (await jwtVerify(tok, secret())).payload.sid as string; } catch { return null; }
  const s = db.prepare("SELECT * FROM sessions WHERE id=?").get(sid) as { user_id: number; created_at: string; last_seen: string; revoked: number } | undefined;
  if (!s || s.revoked) return null;
  const t = Date.now();
  if (t - Date.parse(s.last_seen) > IDLE_MS || t - Date.parse(s.created_at) > ABS_MS) {
    db.prepare("UPDATE sessions SET revoked=1 WHERE id=?").run(sid);
    return null;
  }
  if (touch) db.prepare("UPDATE sessions SET last_seen=? WHERE id=?").run(nowIso(), sid);
  return (db.prepare("SELECT id,email,name,role,must_change_password FROM users WHERE id=? AND active=1").get(s.user_id) as User) ?? null;
}

export async function requireUser(minRole: Role = "staff"): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  const rank = { staff: 0, manager: 1, owner: 2 } as const;
  if (rank[u.role] < rank[minRole]) redirect("/?denied=1");
  return u;
}
export const can = (u: User, min: Role) => ({ staff: 0, manager: 1, owner: 2 })[u.role] >= ({ staff: 0, manager: 1, owner: 2 })[min];

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
