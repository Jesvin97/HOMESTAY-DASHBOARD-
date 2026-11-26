import crypto from "crypto";
import { db } from "./db";

/**
 * Signed requests from the website to /api/public/*.
 * Each call carries x-timestamp (seconds), x-nonce (one-time id) and x-signature =
 *   HMAC-SHA256( WEBSITE_API_SECRET, timestamp \n nonce \n METHOD \n path+query \n sha256(body) ) as hex.
 * A request is accepted only if the signature is right, it is less than 5 minutes old, and the nonce was never used,
 * so a captured request can't be changed or replayed. Calls are server-to-server: the secret never reaches a browser.
 */
const WINDOW_SECONDS = 300;

export const sha256hex = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const signingString = (ts: string, nonce: string, method: string, pathAndQuery: string, body: string) =>
  [ts, nonce, method.toUpperCase(), pathAndQuery, sha256hex(body)].join("\n");
export const sign = (secret: string, ts: string, nonce: string, method: string, pathAndQuery: string, body: string) =>
  crypto.createHmac("sha256", secret).update(signingString(ts, nonce, method, pathAndQuery, body)).digest("hex");

export type VerifyResult = { ok: true } | { ok: false; status: number; error: string };

export async function verifySigned(req: Request, rawBody: string): Promise<VerifyResult> {
  const secret = process.env.WEBSITE_API_SECRET;
  if (!secret || secret.length < 32) return { ok: false, status: 503, error: "API is not configured" };
  const ts = req.headers.get("x-timestamp") ?? "";
  const nonce = req.headers.get("x-nonce") ?? "";
  const sig = req.headers.get("x-signature") ?? "";
  if (!/^\d{10}$/.test(ts) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return { ok: false, status: 401, error: "unauthorized" };

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > WINDOW_SECONDS) return { ok: false, status: 401, error: "request expired" };

  const u = new URL(req.url);
  const expected = sign(secret, ts, nonce, req.method, u.pathname + u.search, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, status: 401, error: "unauthorized" };

  // Only a correctly signed request may use up a nonce (so strangers can't fill the table).
  const used = await db.prepare("INSERT OR IGNORE INTO api_nonces(nonce,ts) VALUES (?,?)").run(nonce, now);
  if (used.changes !== 1) return { ok: false, status: 401, error: "request already used" };
  if (Math.random() < 0.05) await db.prepare("DELETE FROM api_nonces WHERE ts < ?").run(now - 2 * WINDOW_SECONDS).catch(() => {});
  return { ok: true };
}
