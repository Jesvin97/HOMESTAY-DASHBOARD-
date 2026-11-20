import crypto from "crypto";
import QRCode from "qrcode";

/* RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — compatible with Google Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden. Free; no SMS cost. */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function b32encode(buf: Buffer): string {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function b32decode(s: string): Buffer {
  let bits = 0, val = 0; const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(c); if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newSecret = () => b32encode(crypto.randomBytes(20));
const STEP = 30;
export const stepNow = (t = Date.now()) => Math.floor(t / 1000 / STEP);

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, "0");
}
export const totpAt = (secret: string, t = Date.now()) => hotp(secret, stepNow(t));

/** Returns the matched time-step (for replay protection) or null. Accepts ±1 step (±30 s) of clock drift. */
export function verifyTotp(secret: string, input: string, lastUsedStep = 0, t = Date.now()): number | null {
  const code = input.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepNow(t);
  for (const d of [0, -1, 1]) {
    const step = now + d;
    if (step <= lastUsedStep) continue; // a code can be used only once
    const a = Buffer.from(hotp(secret, step)), b = Buffer.from(code);
    if (crypto.timingSafeEqual(a, b)) return step;
  }
  return null;
}

export const otpauthUri = (email: string, secret: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
export const qrDataUrl = (uri: string) => QRCode.toDataURL(uri, { margin: 1, width: 220 });

/* Backup codes: 10 single-use codes, stored only as SHA-256 hashes */
const hashCode = (c: string) => crypto.createHash("sha256").update(c.replace(/[\s-]/g, "").toLowerCase()).digest("hex");
export function newBackupCodes(n = 10) {
  const plain = Array.from({ length: n }, () => { const r = crypto.randomBytes(5).toString("hex"); return `${r.slice(0, 5)}-${r.slice(5)}`; });
  return { plain, hashed: plain.map(hashCode) };
}
/** Returns the remaining hashes if `input` matched one (consuming it), else null. */
export function consumeBackupCode(hashes: string[], input: string): string[] | null {
  const h = hashCode(input);
  const i = hashes.findIndex((x) => x.length === h.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  return i < 0 ? null : hashes.filter((_, j) => j !== i);
}
