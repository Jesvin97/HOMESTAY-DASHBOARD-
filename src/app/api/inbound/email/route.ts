import { NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";

const Body = z.object({ messageId: z.string().max(300).optional(), from: z.string().email().max(200), subject: z.string().max(300).default("(no subject)"), text: z.string().max(20000).default("") });
const COMPLAINT = /complain|refund|disappoint|dirty|rude|poor|bad|issue|problem|not happy|unhappy|worst/i;

/** POST JSON {messageId,from,subject,text} with header x-inbound-secret. Use from a Cloudflare Email Worker (Email Routing) or any mail-to-webhook service. */
export async function POST(req: Request) {
  const want = process.env.INBOUND_EMAIL_SECRET, got = req.headers.get("x-inbound-secret") || "";
  if (!want || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const d = p.data, mid = d.messageId || "hook-" + crypto.randomUUID();
  if (await db.prepare("SELECT 1 FROM emails WHERE message_id=?").get(mid)) return NextResponse.json({ ok: true, duplicate: true });
  const guest = await db.prepare("SELECT id FROM guests WHERE email=? COLLATE NOCASE AND erased_at IS NULL").get<{ id: number }>(d.from);
  const e = await db.prepare("INSERT INTO emails(direction,kind,guest_id,from_addr,subject,body,status,message_id) VALUES ('in','inbound',?,?,?,?,'received',?)").run(guest?.id ?? null, d.from, d.subject, d.text.slice(0, 4000), mid);
  let complaint = false;
  if (COMPLAINT.test(d.subject + " " + d.text.slice(0, 600))) {
    await db.prepare("INSERT INTO complaints(guest_id,subject,body,source,email_id,severity) VALUES (?,?,?,'email',?, 'medium')").run(guest?.id ?? null, d.subject, d.text.slice(0, 2000), e.lastInsertRowid);
    complaint = true;
  }
  return NextResponse.json({ ok: true, complaint });
}
