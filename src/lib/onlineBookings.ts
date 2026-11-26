/**
 * Everything the website needs from the dashboard, in one place (called by the signed /api/public/* routes).
 * The dashboard is the single source of truth: rooms, prices, availability, bookings, payments and refunds.
 * The website only ever asks and reports; the server here recalculates every price and decides every outcome.
 */
import { db, getSetting, st } from "./db";
import { createBooking, cancelBooking } from "./bookings";
import { isRoomFree, quote, refundFor, ROOM_SET, LIVE_BOOKING, type Quote } from "./pricing";
import { executeCashfreeRefund } from "./refunds";
import { isValidDate, nightsBetween, today } from "./dates";

export type RoomRow = { id: number; slug: string; name: string; capacity: number; base_occupancy: number; blocks_all: number; active: number };
type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const MOBILE = /^[6-9]\d{9}$/;
/** Compare phone numbers by their last 10 digits (the dashboard may hold "+91 98765 43210"). */
export const tenDigits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);

const roomBySlug = (slug: string) => db.prepare("SELECT id,slug,name,capacity,base_occupancy,blocks_all,active FROM rooms WHERE slug=? AND active=1").get<RoomRow>(slug);

/** Website add-on codes -> dashboard service ids. An unknown code is an error, never silently ignored. */
async function servicesFromCodes(codes: string[] | undefined): Promise<{ id: number; qty: number }[] | null> {
  const out: { id: number; qty: number }[] = [];
  for (const code of [...new Set(codes ?? [])]) {
    const r = await db.prepare("SELECT id FROM services WHERE code=? AND active=1").get<{ id: number }>(code);
    if (!r) return null;
    out.push({ id: r.id, qty: 1 });
  }
  return out;
}

export type QuoteView = Pick<Quote, "nights" | "roomAmount" | "servicesAmount" | "discount" | "gst" | "total" | "couponError" | "couponCode">;
const view = (q: Quote): QuoteView => ({ nights: q.nights, roomAmount: q.roomAmount, servicesAmount: q.servicesAmount, discount: q.discount, gst: q.gst, total: q.total, couponError: q.couponError, couponCode: q.couponCode });

type Stay = { checkIn: string; checkOut: string; adults: number; children: number; plan: "bb" | "meals" };
function checkStay(s: Stay): string | null {
  if (!isValidDate(s.checkIn) || !isValidDate(s.checkOut)) return "Please choose valid dates.";
  if (s.checkIn < today()) return "Check-in can't be in the past."; // today is allowed: same-day bookings are welcome
  if (nightsBetween(s.checkIn, s.checkOut) < 1) return "Check-out must be after check-in.";
  if (nightsBetween(s.checkIn, s.checkOut) > 30) return "Stays longer than 30 nights, please contact us.";
  if (!Number.isInteger(s.adults) || s.adults < 1 || s.adults > 20 || !Number.isInteger(s.children) || s.children < 0 || s.children > 20) return "Please check the number of guests.";
  if (s.plan !== "bb" && s.plan !== "meals") return "Unknown rate plan.";
  return null;
}

/** Every room, whether it is free for the dates, and what it would cost. */
export async function availability(s: Stay, serviceCodes?: string[], coupon?: string): Promise<Result<{ rooms: { slug: string; name: string; available: boolean; reason?: string; quote: QuoteView | null }[] }>> {
  const bad = checkStay(s);
  if (bad) return fail(400, bad);
  const services = await servicesFromCodes(serviceCodes);
  if (!services) return fail(400, "Unknown add-on.");
  const rooms = await db.prepare("SELECT id,slug,name,capacity,base_occupancy,blocks_all,active FROM rooms WHERE active=1 AND slug IS NOT NULL ORDER BY id").all<RoomRow>();
  const out = [];
  for (const r of rooms) {
    const fits = s.adults + s.children <= r.capacity;
    const free = fits && (await isRoomFree(r.id, s.checkIn, s.checkOut));
    const q = await quote({ roomId: r.id, checkIn: s.checkIn, checkOut: s.checkOut, services, couponCode: coupon, plan: s.plan, adults: s.adults });
    out.push({ slug: r.slug, name: r.name, available: free, reason: free ? undefined : fits ? "booked" : "too_many_guests", quote: view(q) });
  }
  return { ok: true, rooms: out };
}

export async function priceQuote(roomSlug: string, s: Stay, serviceCodes?: string[], coupon?: string): Promise<Result<{ quote: QuoteView }>> {
  const bad = checkStay(s);
  if (bad) return fail(400, bad);
  const room = await roomBySlug(roomSlug);
  if (!room) return fail(404, "Room not found.");
  if (s.adults + s.children > room.capacity) return fail(400, `This room sleeps at most ${room.capacity}.`);
  const services = await servicesFromCodes(serviceCodes);
  if (!services) return fail(400, "Unknown add-on.");
  const q = await quote({ roomId: room.id, checkIn: s.checkIn, checkOut: s.checkOut, services, couponCode: coupon, plan: s.plan, adults: s.adults });
  return { ok: true, quote: view(q) };
}

/** Date ranges already taken for a room (no guest details), merged. */
export async function bookedRanges(roomSlug: string, from: string): Promise<Result<{ booked: { from: string; to: string }[] }>> {
  const room = await roomBySlug(roomSlug);
  if (!room) return fail(404, "Room not found.");
  const rows = await db.prepare(
    `SELECT check_in a, check_out b FROM bookings WHERE room_id IN ${ROOM_SET} AND ${LIVE_BOOKING} AND check_out>?
     UNION ALL SELECT start_date, end_date FROM room_blocks WHERE room_id IN ${ROOM_SET} AND end_date>? ORDER BY 1`,
  ).all<{ a: string; b: string }>(room.id, room.id, from, room.id, room.id, from);
  const out: { from: string; to: string }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && r.a <= last.to) last.to = r.b > last.to ? r.b : last.to;
    else out.push({ from: r.a, to: r.b });
  }
  return { ok: true, booked: out };
}

export type HoldInput = Stay & {
  roomSlug: string; services?: string[]; coupon?: string; consent: boolean; noticeVersion: string;
  guest: { name: string; phone: string; email?: string; bookingFor?: string; otherName?: string; otherPhone?: string; gstin?: string; company?: string; requests?: string[]; message?: string };
};

/**
 * Holds the dates for a guest who is about to pay. The price is worked out here, the dates are checked and taken
 * in one atomic step, and the hold lapses after "web_hold_minutes" if nothing is paid.
 */
export async function createHold(i: HoldInput): Promise<Result<{ code: string; id: number; total: number; quote: QuoteView; expiresAt: string }>> {
  const bad = checkStay(i);
  if (bad) return fail(400, bad);
  if (i.consent !== true) return fail(400, "Consent to the privacy notice is required.");
  const g = i.guest;
  if (!g?.name?.trim() || g.name.trim().length < 2 || g.name.length > 120) return fail(400, "Please enter the guest's name.");
  if (!MOBILE.test(g.phone ?? "")) return fail(400, "Enter a valid 10-digit mobile number.");
  if (g.otherPhone && !MOBILE.test(g.otherPhone)) return fail(400, "Enter a valid 10-digit mobile number for the guest.");
  const email = g.email?.trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return fail(400, "Enter a valid email address.");
  const room = await roomBySlug(i.roomSlug);
  if (!room) return fail(404, "Room not found.");
  const services = await servicesFromCodes(i.services);
  if (!services) return fail(400, "Unknown add-on.");

  const minutes = Number(await getSetting("web_hold_minutes")) || 25;
  const details = { bookingFor: g.bookingFor === "other" ? "other" : "self", otherName: g.otherName, otherPhone: g.otherPhone, gstin: g.gstin, company: g.company, requests: g.requests ?? [], message: g.message?.slice(0, 1000) };
  const r = await createBooking({
    roomId: room.id, checkIn: i.checkIn, checkOut: i.checkOut, adults: i.adults, children: i.children, source: "website", plan: i.plan,
    guest: { name: g.name.trim(), phone: g.phone, email }, services, couponCode: i.coupon || undefined,
    holdMinutes: minutes, contactPhone: g.phone, consent: { at: new Date().toISOString().slice(0, 19).replace("T", " "), version: i.noticeVersion || "web" }, guestDetails: details,
  });
  if (!r.ok) return fail(409, r.error);
  const b = await db.prepare("SELECT total,hold_expires_at FROM bookings WHERE id=?").get<{ total: number; hold_expires_at: string | null }>(r.id);
  const q = await quote({ roomId: room.id, checkIn: i.checkIn, checkOut: i.checkOut, services, couponCode: i.coupon, plan: i.plan, adults: i.adults });
  return { ok: true, code: r.code, id: r.id, total: b!.total, quote: view(q), expiresAt: (b!.hold_expires_at ?? "").replace(" ", "T") + "Z" };
}

/** Remember which Cashfree order belongs to a hold (so a payment can only be applied to its own booking). */
export async function attachProviderOrder(code: string, orderId: string): Promise<Result<object>> {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) return fail(400, "Invalid order id.");
  const r = await db.prepare("UPDATE bookings SET provider_order_id=? WHERE code=? AND status='pending' AND provider_order_id IS NULL").run(orderId, code);
  if (r.changes === 1) return { ok: true };
  const b = await db.prepare("SELECT provider_order_id FROM bookings WHERE code=?").get<{ provider_order_id: string | null }>(code);
  return b?.provider_order_id === orderId ? { ok: true } : fail(409, "This booking can't take an order.");
}

/** The guest never paid (order failed): give the dates back at once. */
export async function releaseHold(code: string): Promise<Result<object>> {
  const b = await db.prepare("SELECT id,status,paid FROM bookings WHERE code=? AND source='website'").get<{ id: number; status: string; paid: number }>(code);
  if (!b) return fail(404, "Booking not found.");
  if (b.status !== "pending" || b.paid > 0) return { ok: true }; // already paid or gone: nothing to release
  try { await cancelBooking(b.id, "Hold released: payment not started", 0); } catch { /* changed meanwhile */ }
  return { ok: true };
}

export type PaymentOutcome = "confirmed" | "already_confirmed" | "refunded" | "refund_failed";

/**
 * The website reports a payment it has ALREADY verified with Cashfree. This confirms the booking only if the amount is
 * exactly the booking total and the dates are still free. If another booking took the dates after the hold lapsed, the
 * guest is refunded in full automatically (so a double booking is never kept). Safe to send twice.
 */
export async function applyOnlinePayment(code: string, p: { orderId: string; paymentId: string; amount: number }): Promise<Result<{ outcome: PaymentOutcome }>> {
  const b = await db.prepare("SELECT * FROM bookings WHERE code=?").get<{ id: number; status: string; total: number; paid: number; coupon_code: string | null; provider_order_id: string | null; provider_payment_id: string | null; check_in: string; check_out: string }>(code);
  if (!b) return fail(404, "Booking not found.");
  if (b.provider_order_id && b.provider_order_id !== p.orderId) return fail(409, "This payment belongs to a different order.");
  if (!Number.isFinite(p.amount) || Math.round(p.amount * 100) !== b.total * 100) return fail(409, "The amount paid does not match the booking total.");
  if (b.provider_payment_id === p.paymentId) {
    // Same payment reported again.
    if (b.status === "confirmed" || b.status === "checked_in" || b.status === "completed") return { ok: true, outcome: "already_confirmed" };
    if (b.status === "cancelled") return { ok: true, outcome: "refunded" };
  }
  if (["confirmed", "checked_in", "completed"].includes(b.status)) return { ok: true, outcome: "already_confirmed" };

  // Confirm (or revive a lapsed hold) only if nothing else holds these dates RIGHT NOW. One atomic statement.
  const set = "(SELECT id FROM rooms WHERE id=bookings.room_id OR blocks_all=1 OR (SELECT blocks_all FROM rooms WHERE id=bookings.room_id)=1)";
  const upd = await db.prepare(
    `UPDATE bookings SET status='confirmed', paid=total, payment_method='online:cashfree', provider_order_id=?, provider_payment_id=?, hold_expires_at=NULL, cancelled_at=NULL, cancel_reason=NULL
     WHERE id=? AND status IN ('pending','cancelled')
       AND NOT EXISTS (SELECT 1 FROM bookings o WHERE o.id!=bookings.id AND o.room_id IN ${set}
            AND o.status NOT IN ('cancelled','no_show') AND (o.status!='pending' OR o.hold_expires_at IS NULL OR o.hold_expires_at>datetime('now'))
            AND o.check_in<bookings.check_out AND o.check_out>bookings.check_in)
       AND NOT EXISTS (SELECT 1 FROM room_blocks k WHERE k.room_id IN ${set} AND k.start_date<bookings.check_out AND k.end_date>bookings.check_in)`,
  ).run(p.orderId, p.paymentId, b.id);
  if (upd.changes === 1) {
    if (b.status === "cancelled" && b.coupon_code) await db.prepare("UPDATE coupons SET used=used+1 WHERE code=? COLLATE NOCASE").run(b.coupon_code);
    return { ok: true, outcome: "confirmed" };
  }

  // The dates were taken while the guest paid. Keep the money trail, cancel, and refund everything.
  await db.prepare("UPDATE bookings SET paid=?, provider_order_id=?, provider_payment_id=?, payment_method='online:cashfree' WHERE id=?").run(b.total, p.orderId, p.paymentId, b.id);
  if (b.status === "pending") await db.prepare("UPDATE bookings SET status='confirmed' WHERE id=? AND status='pending'").run(b.id); // so it can be cancelled by the normal path
  let refundId: number | undefined;
  try {
    const cur = await db.prepare("SELECT status FROM bookings WHERE id=?").get<{ status: string }>(b.id);
    if (cur?.status === "cancelled") {
      // Already cancelled earlier: make sure one full refund exists.
      const ex = await db.prepare("SELECT id FROM refunds WHERE booking_id=? AND status!='rejected' ORDER BY id DESC LIMIT 1").get<{ id: number }>(b.id);
      if (ex) refundId = ex.id;
      else {
        refundId = Number((await db.prepare("INSERT INTO refunds(booking_id,amount,status,policy_note,proposed_by,decided_at,percent,method) VALUES (?,?,'approved',?,0,datetime('now'),100,'cashfree')").run(b.id, b.total, "Dates were taken while the guest was paying: full refund")).lastInsertRowid);
      }
    } else {
      const c = await cancelBooking(b.id, "Dates were taken while the guest was paying", 0, 100, true);
      refundId = c.refundId;
    }
  } catch { /* fall through: reported as refund_failed so a person can act */ }
  if (!refundId) return { ok: true, outcome: "refund_failed" };
  const done = await executeCashfreeRefund(refundId);
  return { ok: true, outcome: done.status === "failed" ? "refund_failed" : "refunded" };
}

export type PublicBooking = {
  code: string; status: string; confirmed: boolean; roomSlug: string | null; roomName: string; checkIn: string; checkOut: string; adults: number; children: number;
  plan: string; total: number; paid: number; guestFirstName: string; phoneLast4: string; createdAt: string; provider: { orderId: string | null; paymentId: string | null };
};

async function bookingRow(code: string) {
  return db.prepare(
    `SELECT b.*, r.slug AS room_slug, r.name AS room_name, g.name AS guest_name, g.phone AS guest_phone FROM bookings b
       JOIN rooms r ON r.id=b.room_id JOIN guests g ON g.id=b.guest_id WHERE b.code=?`,
  ).get<{ id: number; code: string; status: string; room_slug: string | null; room_name: string; check_in: string; check_out: string; adults: number; children: number; plan: string; total: number; paid: number;
    guest_name: string; guest_phone: string | null; contact_phone: string | null; created_at: string; provider_order_id: string | null; provider_payment_id: string | null }>(code);
}
const toPublic = (b: NonNullable<Awaited<ReturnType<typeof bookingRow>>>): PublicBooking => ({
  code: b.code, status: b.status, confirmed: ["confirmed", "checked_in", "completed"].includes(b.status) && b.paid >= b.total, roomSlug: b.room_slug, roomName: b.room_name,
  checkIn: b.check_in, checkOut: b.check_out, adults: b.adults, children: b.children, plan: b.plan, total: b.total, paid: b.paid,
  guestFirstName: b.guest_name.trim().split(/\s+/)[0] ?? "", phoneLast4: tenDigits(b.contact_phone ?? b.guest_phone).slice(-4), createdAt: b.created_at, provider: { orderId: b.provider_order_id, paymentId: b.provider_payment_id },
});

/** A booking's public summary (first name and last 4 digits of the phone only). */
export async function publicBooking(code: string): Promise<Result<{ booking: PublicBooking }>> {
  const b = await bookingRow(code);
  return b ? { ok: true, booking: toPublic(b) } : fail(404, "Booking not found.");
}

export type CancelView = { canCancel: boolean; daysBefore: number; percent: number; refund: number; alreadyCancelled: boolean; refundStatus: string | null };

/** The guest proves it is theirs with the booking code AND the mobile number used. Shows what they would be refunded today. */
export async function lookupForGuest(code: string, phone: string): Promise<Result<{ booking: PublicBooking; cancel: CancelView }>> {
  const b = await bookingRow(code);
  if (!b || !MOBILE.test(phone) || tenDigits(b.contact_phone ?? b.guest_phone) !== phone) return fail(404, "We couldn't find a booking with that ID and mobile number.");
  const pol = await refundFor(b.check_in, b.paid);
  const open = b.status === "pending" || b.status === "confirmed";
  const rf = b.status === "cancelled" ? await db.prepare("SELECT status,amount,percent FROM refunds WHERE booking_id=? ORDER BY id DESC LIMIT 1").get<{ status: string; amount: number; percent: number | null }>(b.id) : undefined;
  return {
    ok: true, booking: toPublic(b),
    cancel: { canCancel: open && pol.days >= 0, daysBefore: pol.days, percent: b.status === "cancelled" ? rf?.percent ?? 0 : pol.pct, refund: b.status === "cancelled" ? rf?.amount ?? 0 : pol.amount, alreadyCancelled: b.status === "cancelled", refundStatus: rf?.status ?? null },
  };
}

export type CancelOutcome = { cancelled: true; refund: number; percent: number; refundStatus: "none" | "paid" | "processing" | "failed" | "awaiting_approval"; alreadyCancelled: boolean };

/** Cancels a guest's booking and refunds what the policy allows for TODAY. All numbers come from the dates, never from the website. */
export async function cancelByGuest(code: string, phone: string): Promise<Result<CancelOutcome>> {
  const b = await bookingRow(code);
  if (!b || !MOBILE.test(phone) || tenDigits(b.contact_phone ?? b.guest_phone) !== phone) return fail(404, "We couldn't find a booking with that ID and mobile number.");

  const map = (s: string | null): CancelOutcome["refundStatus"] => (s === "paid" ? "paid" : s === "approved" ? "processing" : s === "failed" ? "failed" : s === "proposed" ? "awaiting_approval" : "none");
  if (b.status === "cancelled") {
    // Already cancelled: report it, and retry a refund that failed.
    let rf = await db.prepare("SELECT id,status,amount,percent FROM refunds WHERE booking_id=? AND status!='rejected' ORDER BY id DESC LIMIT 1").get<{ id: number; status: string; amount: number; percent: number | null }>(b.id);
    if (rf && ["approved", "failed"].includes(rf.status)) { await executeCashfreeRefund(rf.id); rf = await db.prepare("SELECT id,status,amount,percent FROM refunds WHERE id=?").get(rf.id); }
    return { ok: true, cancelled: true, refund: rf?.amount ?? 0, percent: rf?.percent ?? 0, refundStatus: map(rf?.status ?? null), alreadyCancelled: true };
  }
  if (b.status !== "pending" && b.status !== "confirmed") return fail(409, "This booking can't be cancelled online. Please call us.");
  const pol = await refundFor(b.check_in, b.paid);
  if (pol.days < 0) return fail(409, "This stay has already started, so it can't be cancelled online. Please call us.");

  const auto = (await getSetting("auto_refund_online")) === "1";
  let c;
  try { c = await cancelBooking(b.id, "Cancelled online by the guest", 0, undefined, auto); }
  catch { return fail(409, "This booking was just changed. Please try again."); }

  if (!c.refundId) return { ok: true, cancelled: true, refund: 0, percent: pol.pct, refundStatus: "none", alreadyCancelled: false };
  if (!auto) return { ok: true, cancelled: true, refund: c.refund, percent: pol.pct, refundStatus: "awaiting_approval", alreadyCancelled: false };
  const done = await executeCashfreeRefund(c.refundId);
  return { ok: true, cancelled: true, refund: c.refund, percent: pol.pct, refundStatus: done.status === "paid" ? "paid" : done.status === "approved" ? "processing" : "failed", alreadyCancelled: false };
}

/** "Request a callback" from the website. */
export async function createLead(p: { name: string; phone: string; note?: string; consent: boolean; noticeVersion: string }): Promise<Result<object>> {
  if (p.consent !== true) return fail(400, "Consent is required.");
  if (!p.name?.trim() || p.name.length > 100 || !MOBILE.test(p.phone ?? "")) return fail(400, "Please check the name and mobile number.");
  await db.batch([st("INSERT INTO leads(kind,name,phone,note,consent_at,consent_version) VALUES ('callback',?,?,?,datetime('now'),?)", p.name.trim(), p.phone, p.note?.slice(0, 300) ?? null, p.noticeVersion || "web")]);
  return { ok: true };
}

