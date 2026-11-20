import nodemailer from "nodemailer";
import { db, getSetting } from "./db";
import { fmtDate, inr } from "./dates";

type Sent = { status: "sent" | "dry_run" | "failed"; error?: string };

function transport() {
  const url = process.env.SMTP_URL;
  return url ? nodemailer.createTransport(url) : null;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendMail(o: { to: string; subject: string; html: string; kind: string; bookingId?: number; guestId?: number; headers?: Record<string, string> }): Promise<Sent> {
  const from = process.env.MAIL_FROM || `${await getSetting("property_name")} <no-reply@example.com>`;
  const t = transport();
  let res: Sent;
  if (!t) res = { status: "dry_run" };
  else {
    try { await t.sendMail({ from, to: o.to, subject: o.subject, html: o.html, headers: o.headers }); res = { status: "sent" }; }
    catch (e) { res = { status: "failed", error: (e as Error).message }; }
  }
  await db.prepare("INSERT INTO emails(direction,kind,booking_id,guest_id,from_addr,to_addr,subject,body,status,error) VALUES ('out',?,?,?,?,?,?,?,?,?)").run(
    o.kind, o.bookingId ?? null, o.guestId ?? null, from, o.to, o.subject, o.html, res.status, res.error ?? null,
  );
  return res;
}

type B = { id: number; code: string; check_in: string; check_out: string; total: number; paid: number; room_name: string; guest_name: string; email: string | null; adults: number; children: number };
const loadB = async (id: number) => await db.prepare(
  `SELECT b.*, r.name room_name, g.name guest_name, g.email FROM bookings b JOIN rooms r ON r.id=b.room_id JOIN guests g ON g.id=b.guest_id WHERE b.id=?`,
).get(id) as B | undefined;

export async function sendBookingConfirmation(bookingId: number) {
  const b = await loadB(bookingId);
  if (!b?.email) return { status: "failed" as const, error: "Guest has no email" };
  const name = esc(await getSetting("property_name"));
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px"><h2>Booking confirmed — ${name}</h2>
  <p>Dear ${esc(b.guest_name)}, thank you for booking with us.</p>
  <table cellpadding="6"><tr><td>Booking ref</td><td><b>${b.code}</b></td></tr>
  <tr><td>Room</td><td>${esc(b.room_name)}</td></tr>
  <tr><td>Check-in</td><td>${fmtDate(b.check_in)}</td></tr><tr><td>Check-out</td><td>${fmtDate(b.check_out)}</td></tr>
  <tr><td>Guests</td><td>${b.adults} adult(s), ${b.children} child(ren)</td></tr>
  <tr><td>Total</td><td>${inr(b.total)}</td></tr><tr><td>Paid</td><td>${inr(b.paid)}</td></tr>
  <tr><td>Balance</td><td>${inr(b.total - b.paid)}</td></tr></table>
  <p>Contact: ${esc(await getSetting("property_phone"))} · ${esc(await getSetting("property_email"))}</p>
  <p style="color:#666;font-size:12px">Cancellation policy applies as published on our website.</p></div>`;
  const r = await sendMail({ to: b.email, subject: `Booking confirmed ${b.code} — ${await getSetting("property_name")}`, html, kind: "booking_confirmation", bookingId });
  await db.prepare("UPDATE bookings SET confirmation_status=?, confirmation_sent_at=datetime('now') WHERE id=?").run(
    r.status === "sent" ? "sent" : r.status === "dry_run" ? "dry_run" : "failed", bookingId,
  );
  return r;
}

export async function sendCancellationEmail(bookingId: number, refundAmount: number) {
  const b = await loadB(bookingId);
  if (!b?.email) return;
  await sendMail({
    to: b.email, kind: "cancellation", bookingId, subject: `Booking ${b.code} cancelled`,
    html: `<p>Dear ${esc(b.guest_name)}, your booking <b>${b.code}</b> has been cancelled.</p>${refundAmount ? `<p>A refund of <b>${inr(refundAmount)}</b> will be sent to your UPI ID after approval.</p>` : "<p>No refund is applicable under our cancellation policy.</p>"}`,
  });
}

export function unsubLink(token: string) {
  const base = process.env.APP_URL || "http://localhost:3000";
  return `${base}/unsubscribe/${token}`;
}

/** Inbound complaint mail via IMAP. No-op (returns reason) when IMAP isn't configured. */
export async function syncInbox(): Promise<{ imported: number; note?: string }> {
  const { IMAP_HOST, IMAP_USER, IMAP_PASSWORD } = process.env;
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) return { imported: 0, note: "IMAP not configured — add IMAP_* env vars, or log complaints manually." };
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({ host: IMAP_HOST, port: 993, secure: true, auth: { user: IMAP_USER, pass: IMAP_PASSWORD }, logger: false });
  let imported = 0;
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const since = new Date(Date.now() - 14 * 86400000);
    for await (const m of client.fetch({ since }, { envelope: true, source: true, uid: true })) {
      const mid = m.envelope?.messageId || `uid-${m.uid}`;
      if (await db.prepare("SELECT 1 FROM emails WHERE message_id=?").get(mid)) continue;
      const from = m.envelope?.from?.[0]?.address || "";
      const subject = m.envelope?.subject || "(no subject)";
      const raw = m.source?.toString("utf8") || "";
      const body = raw.split(/\r?\n\r?\n/).slice(1).join("\n\n").slice(0, 4000);
      const guest = from ? (await db.prepare("SELECT id FROM guests WHERE email=? COLLATE NOCASE").get(from) as { id: number } | undefined) : undefined;
      const info = await db.prepare("INSERT INTO emails(direction,kind,guest_id,from_addr,to_addr,subject,body,status,message_id) VALUES ('in','inbound',?,?,?,?,?,'received',?)").run(guest?.id ?? null, from, IMAP_USER, subject, body, mid);
      if (/complain|refund|disappoint|dirty|rude|poor|bad|issue|problem|not happy|unhappy|worst/i.test(subject + " " + body.slice(0, 600))) {
        await db.prepare("INSERT INTO complaints(guest_id,subject,body,source,email_id,severity) VALUES (?,?,?,?,?, 'medium')").run(guest?.id ?? null, subject, body.slice(0, 2000), "email", info.lastInsertRowid);
      }
      imported++;
    }
  } finally { lock.release(); await client.logout(); }
  return { imported };
}
