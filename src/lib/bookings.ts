import { db, getSetting, st } from "./db";
import { encrypt } from "./crypto";
import { randomToken } from "./crypto";
import { quote, isRoomFree, refundFor, ROOM_SET, LIVE_BOOKING } from "./pricing";
import { isValidDate, nightsBetween, addDays, today } from "./dates";

export type GuestInput = { name: string; phone?: string; email?: string; aadhaar?: string; consentMarketing?: boolean; consentWhatsapp?: boolean };

export async function upsertGuest(g: GuestInput, source = "booking"): Promise<{ id: number; isNew: boolean }> {
  const phone = g.phone?.replace(/\s/g, "") || null;
  const email = g.email?.trim().toLowerCase() || null;
  let row = (phone && (await db.prepare("SELECT id FROM guests WHERE phone=? AND erased_at IS NULL").get(phone) as { id: number } | undefined)) ||
    (email && (await db.prepare("SELECT id FROM guests WHERE email=? AND erased_at IS NULL").get(email) as { id: number } | undefined)) || undefined;
  let id: number, isNew = false;
  if (row) {
    id = row.id;
    // Never overwrite an existing guest's NAME from a new booking (someone could type another person's phone); only fill gaps.
    await db.prepare("UPDATE guests SET phone=COALESCE(phone,?), email=COALESCE(email,?) WHERE id=?").run(phone, email, id);
  } else {
    id = Number((await db.prepare("INSERT INTO guests(name,phone,email,unsub_token) VALUES (?,?,?,?)").run(g.name.trim(), phone, email, randomToken(16))).lastInsertRowid);
    isNew = true;
  }
  // A booking can only ever GRANT consent. An unticked box means "not asked", never "withdraw".
  if (g.consentMarketing) await setConsent(id, "marketing_email", true, source);
  if (g.consentWhatsapp) await setConsent(id, "whatsapp", true, source);
  if (g.aadhaar) await storeAadhaar(id, g.aadhaar);
  return { id, isNew };
}

/** Records consent only when the value changes (keeps the consent log meaningful). */
export async function setConsent(guestId: number, purpose: "marketing_email" | "whatsapp", granted: boolean, source: string) {
  const col = purpose === "marketing_email" ? "consent_marketing" : "consent_whatsapp";
  const cur = await db.prepare(`SELECT ${col} v FROM guests WHERE id=?`).get(guestId) as { v: number };
  if (!!cur.v === granted && await db.prepare("SELECT 1 FROM consents WHERE guest_id=? AND purpose=?").get(guestId, purpose)) return;
  await db.prepare(`UPDATE guests SET ${col}=? WHERE id=?`).run(granted ? 1 : 0, guestId);
  await db.prepare("INSERT INTO consents(guest_id,purpose,granted,source,notice_version) VALUES (?,?,?,?,?)").run(guestId, purpose, granted ? 1 : 0, source, await getSetting("notice_version"));
}

export function validAadhaar(n: string) {
  const d = n.replace(/\s/g, "");
  if (!/^[2-9]\d{11}$/.test(d)) return false;
  // Verhoeff checksum
  const mul = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const perm = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  let c = 0;
  [...d].reverse().forEach((ch, i) => { c = mul[c][perm[i % 8][Number(ch)]]; });
  return c === 0;
}

export async function storeAadhaar(guestId: number, raw: string) {
  const d = raw.replace(/\s/g, "");
  if (!validAadhaar(d)) throw new Error("Invalid Aadhaar number.");
  await db.prepare("UPDATE guests SET aadhaar_enc=?, aadhaar_last4=?, aadhaar_purpose=? WHERE id=?").run(encrypt(d), d.slice(-4), "Guest identity verification at check-in", guestId);
  await scheduleAadhaarDeletion(guestId);
}
/** Delete date = (latest live stay's check-out, or today) + retention days. Re-evaluated whenever a stay ends or is cancelled. */
export async function scheduleAadhaarDeletion(guestId: number) {
  const days = Number((await getSetting("aadhaar_retention_days")) || 30);
  const last = await db.prepare("SELECT MAX(check_out) m FROM bookings WHERE guest_id=? AND status IN ('pending','confirmed','checked_in','completed')").get<{ m: string | null }>(guestId);
  const anchor = last?.m && last.m > today() ? last.m : today();
  await db.prepare("UPDATE guests SET aadhaar_delete_after=? WHERE id=? AND aadhaar_enc IS NOT NULL").run(addDays(anchor, days), guestId);
}

export const pointsStmts = (guestId: number, points: number, reason: string, bookingId?: number, by?: number) => [
  st("INSERT INTO loyalty_ledger(guest_id,points,reason,booking_id,created_by) VALUES (?,?,?,?,?)", guestId, points, reason, bookingId ?? null, by ?? null),
  st("UPDATE guests SET loyalty_points=MAX(0,loyalty_points+?) WHERE id=?", points, guestId),
];
export async function addPoints(guestId: number, points: number, reason: string, bookingId?: number, by?: number) {
  await db.batch(pointsStmts(guestId, points, reason, bookingId, by));
}

export type Tier = { name: string; minStays: number };
export async function loadTiers(): Promise<Tier[]> { return JSON.parse(await getSetting("loyalty_tiers")) as Tier[]; }
export const tierName = (tiers: Tier[], stays: number): string => [...tiers].sort((a, b) => b.minStays - a.minStays).find((t) => stays >= t.minStays)?.name ?? "Member";
export const completedStays = async (guestId: number) =>
  ((await db.prepare("SELECT COUNT(*) c FROM bookings WHERE guest_id=? AND status='completed'").get(guestId)) as { c: number }).c;

export type CreateBookingInput = {
  roomId: number; checkIn: string; checkOut: string; adults: number; children: number; guest: GuestInput;
  source: string; services?: { id: number; qty: number }[]; couponCode?: string; redeemPoints?: number;
  paid?: number; paymentMethod?: string; notes?: string; createdBy?: number; commissionPct?: number;
  /** "meals" = all-meals plan. Default bed and breakfast. */
  plan?: "bb" | "meals";
  /** Website holds: minutes the unpaid booking keeps the dates. Omit for owner-entered bookings (the hourly 24h rule applies). */
  holdMinutes?: number;
  /** Privacy-notice consent given by the guest on the website. */
  consent?: { at: string; version: string };
  /** Booking-for-someone-else, GST invoice details, special requests (stored as JSON). */
  guestDetails?: unknown;
};

export async function createBooking(i: CreateBookingInput): Promise<{ ok: true; id: number; code: string; status: string } | { ok: false; error: string }> {
  if (!isValidDate(i.checkIn) || !isValidDate(i.checkOut) || nightsBetween(i.checkIn, i.checkOut) < 1) return { ok: false, error: "Check-out must be after check-in." };
  const room = await db.prepare("SELECT * FROM rooms WHERE id=? AND active=1").get<{ capacity: number }>(i.roomId);
  if (!room) return { ok: false, error: "Room not available." };
  if (i.adults + i.children > room.capacity) return { ok: false, error: `Room sleeps at most ${room.capacity}.` };
  if (!(i.adults >= 1) || i.children < 0) return { ok: false, error: "At least one adult is required." };
  if (nightsBetween(i.checkIn, i.checkOut) > 60) return { ok: false, error: "Stays longer than 60 nights aren't supported." };
  if (!i.guest.name?.trim()) return { ok: false, error: "Guest name is required." };
  if (!i.guest.phone && !i.guest.email) return { ok: false, error: "Phone or email is required." };
  if (!(await isRoomFree(i.roomId, i.checkIn, i.checkOut))) return { ok: false, error: "Room is not available for those dates." };

  const { id: guestId, isNew } = await upsertGuest(i.guest, i.source === "website" ? "website_booking" : "dashboard_booking");
  const q = await quote({ roomId: i.roomId, checkIn: i.checkIn, checkOut: i.checkOut, services: i.services, couponCode: i.couponCode, guestId, redeemPoints: i.redeemPoints, plan: i.plan, adults: i.adults });
  if (i.couponCode && q.couponError) return { ok: false, error: "Coupon: " + q.couponError };
  const code = "HS-" + new Date().toISOString().slice(2, 7).replace("-", "") + "-" + randomToken(3).toUpperCase();
  // RULE: a booking is CONFIRMED only when the full amount has been received. Otherwise it is PENDING and holds the room for a limited time.
  const paidNow = Math.min(Math.max(0, i.paid ?? 0), q.total);
  const status = q.total > 0 && paidNow >= q.total ? "confirmed" : "pending";
  const commission = i.commissionPct ? Math.round((q.total * i.commissionPct) / 100) : 0;

  // ATOMIC availability guard: the row is only inserted if no overlapping booking/block exists *at the moment of insert*,
  // so two simultaneous requests (website + owner + OTA) can never both win — works on D1, which has no interactive transactions.
  // The whole house clashes with every room and every room clashes with the whole house; lapsed unpaid website holds don't count.
  const holdUntil = i.holdMinutes ? new Date(Date.now() + i.holdMinutes * 60_000).toISOString().slice(0, 19).replace("T", " ") : null;
  const ins = await db.prepare(
    `INSERT INTO bookings(code,guest_id,room_id,check_in,check_out,adults,children,status,source,room_amount,services_amount,discount,loyalty_discount,gst,total,paid,payment_method,coupon_code,notes,commission,created_by,plan,hold_expires_at,consent_at,consent_version,guest_details)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
     WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE room_id IN ${ROOM_SET} AND ${LIVE_BOOKING} AND check_in<? AND check_out>?)
       AND NOT EXISTS (SELECT 1 FROM room_blocks WHERE room_id IN ${ROOM_SET} AND start_date<? AND end_date>?)`,
  ).run(code, guestId, i.roomId, i.checkIn, i.checkOut, i.adults, i.children, status, i.source, q.roomAmount, q.servicesAmount, q.discount, q.loyaltyDiscount, q.gst, q.total,
    paidNow, i.paymentMethod ?? null, q.couponCode ?? null, i.notes ?? null, commission, i.createdBy ?? null,
    i.plan ?? "bb", status === "pending" ? holdUntil : null, i.consent?.at ?? null, i.consent?.version ?? null, i.guestDetails ? JSON.stringify(i.guestDetails) : null,
    i.roomId, i.roomId, i.checkOut, i.checkIn, i.roomId, i.roomId, i.checkOut, i.checkIn);
  if (ins.changes !== 1) return { ok: false, error: "Room is not available for those dates." };
  const id = ins.lastInsertRowid;

  const after: ReturnType<typeof st>[] = [];
  if (isNew) { const bonus = Number((await getSetting("loyalty_welcome_bonus")) || 0); if (bonus) after.push(...pointsStmts(guestId, bonus, "Welcome bonus", id)); }
  for (const s of i.services || []) {
    const row = await db.prepare("SELECT price,included FROM services WHERE id=?").get<{ price: number; included: number }>(s.id);
    if (row) after.push(st("INSERT INTO booking_services(booking_id,service_id,qty,price) VALUES (?,?,?,?)", id, s.id, s.qty, row.included ? 0 : row.price));
  }
  if (q.couponCode) after.push(st("UPDATE coupons SET used=used+1 WHERE code=? COLLATE NOCASE", q.couponCode));
  if (q.loyaltyDiscount) after.push(...pointsStmts(guestId, -Math.round(q.loyaltyDiscount / Number(await getSetting("loyalty_point_value") || 1)), "Redeemed on " + code, id, i.createdBy));
  await db.batch(after);
  return { ok: true, id, code, status };
}

/**
 * Cancels the booking and records the refund the policy allows. By default the refund is only PROPOSED:
 * money moves after a human approves it on /refunds. With `auto` (a guest's online cancellation, when the
 * "auto refund" setting is on) it is created already approved and the caller sends it to Cashfree.
 * The cancellation is claimed in ONE atomic statement, so a booking can never be cancelled (or refunded) twice.
 */
export async function cancelBooking(bookingId: number, reason: string, by: number, overridePct?: number, auto = false) {
  const b = await db.prepare("SELECT * FROM bookings WHERE id=?").get<{ id: number; code: string; status: string; paid: number; check_in: string; coupon_code: string | null; guest_id: number; loyalty_discount: number }>(bookingId);
  if (!b) throw new Error("Booking not found");
  if (!["pending", "confirmed"].includes(b.status)) throw new Error(`A ${b.status.replace("_", " ")} booking can't be cancelled.`);
  if (overridePct != null && (!Number.isFinite(overridePct) || overridePct < 0 || overridePct > 100)) throw new Error("Refund % must be between 0 and 100.");
  const pol = await refundFor(b.check_in, b.paid);
  const pct = overridePct ?? pol.pct;
  const amount = overridePct != null ? Math.round((b.paid * overridePct) / 100) : pol.amount;
  const claim = await db.prepare("UPDATE bookings SET status='cancelled', cancelled_at=datetime('now'), cancel_reason=? WHERE id=? AND status IN ('pending','confirmed')").run(reason, bookingId);
  if (claim.changes !== 1) throw new Error("This booking was just changed by someone else. Reload and check it.");
  const stmts: ReturnType<typeof st>[] = [];
  if (b.coupon_code) stmts.push(st("UPDATE coupons SET used=MAX(0,used-1) WHERE code=? COLLATE NOCASE", b.coupon_code));
  if (amount > 0) {
    const note = overridePct != null ? `Manual override: ${overridePct}% (policy said ${pol.pct}%)` : pol.note;
    stmts.push(auto
      ? st("INSERT INTO refunds(booking_id,amount,status,policy_note,proposed_by,decided_at,percent,method) VALUES (?,?,'approved',?,?,datetime('now'),?,'cashfree')", bookingId, amount, note, by, pct)
      : st("INSERT INTO refunds(booking_id,amount,status,policy_note,proposed_by,percent) VALUES (?,?,'proposed',?,?,?)", bookingId, amount, note, by, pct));
  }
  if (b.loyalty_discount > 0) stmts.push(...pointsStmts(b.guest_id, Math.round(b.loyalty_discount / Number((await getSetting("loyalty_point_value")) || 1)), `Points returned: ${b.code} cancelled`, bookingId, by));
  if (stmts.length) await db.batch(stmts);
  await scheduleAadhaarDeletion(b.guest_id);
  const refundId = amount > 0 ? (await db.prepare("SELECT id FROM refunds WHERE booking_id=? ORDER BY id DESC LIMIT 1").get<{ id: number }>(bookingId))?.id : undefined;
  return { refund: amount, policy: pol, refundId };
}

/** Check-out: award loyalty points, queue testimonial request, set Aadhaar deletion date. */
export async function completeBooking(bookingId: number, by: number) {
  const b = await db.prepare("SELECT * FROM bookings WHERE id=?").get<{ id: number; code: string; guest_id: number; total: number; gst: number; status: string }>(bookingId);
  if (!b || !["confirmed", "checked_in"].includes(b.status)) return;
  const pts = Math.floor(((b.total - b.gst) / 100) * Number((await getSetting("loyalty_points_per_100")) || 0));
  const days = Number((await getSetting("aadhaar_retention_days")) || 30);
  await db.batch([
    st("UPDATE bookings SET status='completed' WHERE id=?", bookingId),
    ...(pts > 0 ? pointsStmts(b.guest_id, pts, `Stay ${b.code}`, bookingId, by) : []),
    st("INSERT INTO testimonials(guest_id,booking_id,status,token) VALUES (?,?,'queued',?)", b.guest_id, bookingId, randomToken(12)),
    st("UPDATE guests SET aadhaar_delete_after=? WHERE id=? AND aadhaar_enc IS NOT NULL", addDays(today(), days), b.guest_id),
  ]);
  await scheduleAadhaarDeletion(b.guest_id);
}

/** Record money received. Returns whether this payment completed the booking and thereby CONFIRMED it. */
export async function recordPayment(bookingId: number, amount: number, method: string): Promise<{ ok: true; confirmed: boolean; balance: number } | { ok: false; error: string }> {
  const b = await db.prepare("SELECT status,total,paid FROM bookings WHERE id=?").get<{ status: string; total: number; paid: number }>(bookingId);
  if (!b) return { ok: false, error: "Booking not found." };
  if (!["pending", "confirmed", "checked_in"].includes(b.status)) return { ok: false, error: `Can't take payment on a ${b.status.replace("_", " ")} booking.` };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Enter an amount above zero." };
  if (b.paid + amount > b.total) return { ok: false, error: `That is more than the balance (₹${b.total - b.paid}).` };
  const full = b.paid + amount >= b.total;
  await db.batch([
    st("UPDATE bookings SET paid=paid+?, payment_method=? WHERE id=?", amount, method, bookingId),
    ...(full && b.status === "pending" ? [st("UPDATE bookings SET status='confirmed' WHERE id=? AND status='pending'", bookingId)] : []),
  ]);
  return { ok: true, confirmed: full && b.status === "pending", balance: b.total - b.paid - amount };
}

/**
 * Release rooms held by bookings that got no money. Website holds lapse at their own hold_expires_at (minutes);
 * owner-entered pending bookings after the "payment_hold_hours" setting. Partially-paid holds are NOT auto-cancelled
 * (a human decides: refund policy applies). A lapsed hold never blocks dates anyway; this only tidies the list.
 */
export async function expireUnpaidHolds(): Promise<number> {
  const hours = Number((await getSetting("payment_hold_hours")) || 24);
  const rows = await db.prepare(
    `SELECT id,hold_expires_at FROM bookings WHERE status='pending' AND paid=0 AND (
       (hold_expires_at IS NOT NULL AND hold_expires_at < datetime('now'))
       OR (hold_expires_at IS NULL AND ? > 0 AND created_at < datetime('now', ?)))`,
  ).all<{ id: number; hold_expires_at: string | null }>(hours, `-${hours} hours`);
  for (const r of rows) {
    try { await cancelBooking(r.id, r.hold_expires_at ? "Auto-released: payment not completed in time" : `Auto-released: no payment within ${hours}h`, 0); } catch { /* already changed */ }
  }
  return rows.length;
}
