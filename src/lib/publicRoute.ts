import { NextResponse } from "next/server";
import { verifySigned } from "./signedApi";
import { limited } from "./rateLimit";

export const CODE_RE = /^[A-Z0-9-]{6,30}$/;
const NO_STORE = { "Cache-Control": "no-store" };
export const reply = (json: unknown, status = 200) => NextResponse.json(json, { status, headers: NO_STORE });

type Ctx = { body: Record<string, unknown>; url: URL };
type Out = { ok: true } | { ok: false; status: number; error: string };

/**
 * Wraps a /api/public/* handler: reads the body once, checks the signature (see signedApi.ts), limits request volume,
 * parses JSON, then runs the handler. Handlers return plain objects: {ok:true,...} or {ok:false,status,error}.
 */
export async function signedRoute(req: Request, run: (c: Ctx) => Promise<Out & Record<string, unknown>>): Promise<NextResponse> {
  const raw = req.method === "GET" ? "" : await req.text();
  if (raw.length > 20_000) return reply({ error: "request too large" }, 413);
  const v = await verifySigned(req, raw);
  if (!v.ok) return reply({ error: v.error }, v.status);
  if (limited("pub:" + new URL(req.url).pathname, 600, 60_000)) return reply({ error: "too many requests" }, 429);
  let body: Record<string, unknown> = {};
  if (raw) {
    try { body = JSON.parse(raw); } catch { return reply({ error: "invalid JSON" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "invalid body" }, 400);
  }
  try {
    const r = await run({ body, url: new URL(req.url) });
    if (r.ok === false) return reply({ error: r.error }, r.status);
    return reply(r);
  } catch (e) {
    console.error("public api error", e);
    return reply({ error: "server error" }, 500);
  }
}

export const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
export const int = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : fallback);
export const strList = (v: unknown, max = 20) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max).map((x) => (x as string).slice(0, 60)) : []);
export const planOf = (v: unknown): "bb" | "meals" => (v === "meals" ? "meals" : "bb");
