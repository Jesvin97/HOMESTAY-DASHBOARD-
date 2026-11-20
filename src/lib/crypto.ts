import crypto from "crypto";

function key(): Buffer {
  const k = process.env.DATA_KEY;
  if (!k) {
    if (process.env.NODE_ENV === "production") throw new Error("DATA_KEY must be set in production");
    return crypto.createHash("sha256").update("dev-only-data-key").digest();
  }
  return crypto.createHash("sha256").update(k).digest();
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext) */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function decrypt(blob: string): string {
  const b = Buffer.from(blob, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
export const randomToken = (n = 24) => crypto.randomBytes(n).toString("hex");
