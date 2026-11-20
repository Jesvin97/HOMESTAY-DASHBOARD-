import crypto from "crypto";
export function checkApiKey(req: Request): boolean {
  const k = process.env.WEBSITE_API_KEY;
  const got = req.headers.get("x-api-key") || "";
  if (!k) return process.env.NODE_ENV !== "production"; // open only in dev
  const a = Buffer.from(got), b = Buffer.from(k);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
