/** Tiny in-memory fixed-window limiter (per server instance). Enough to blunt scripts; use Cloudflare WAF rate-limit rules for real protection. */
const hits = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs: number): boolean {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
  return arr.length > max;
}
export const ipOf = (req: Request) => (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
