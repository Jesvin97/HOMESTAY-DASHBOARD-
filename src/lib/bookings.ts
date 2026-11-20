import { db, getSetting, st } from "./db";
import { encrypt } from "./crypto";
import { randomToken } from "./crypto";
import { quote, isRoomFree, refundFor } from "./pricing";
import { isValidDate, nightsBetween, addDays, today } from "./dates";

export type GuestInput = { name: string; phone?: string; email?: string; aadhaar?: string; consentMarketing?: boolean; consentWhatsapp?: boolean };

export async function upsertGuest(g: GuestInput, source = "booking"): Promise<number> {
  const phone = g.phone?.replace(/\s/g, "") || null;
  const email = g.email?.trim().toLowerCase() || null;
  let row = (phone && (await db.prepare("SELECT id FROM guests WHERE phone=? AND erased_at IS NULL").get(phone) as { id: number } | undefined)) ||
    (email && (await db.prepare("SELECT id FROM guests WHERE email=? AND erased_at IS NULL").get(email) as { id: number } | undefined)) || undefined;
  let id: number;
  if (row) {
    id = row.id;
    await db.prepare("UPDATE guests SET name=?, phone=COALESCE(?,phone), email=COALESCE(?,email) WHERE id=?").run(g.name, phone, email, id);
  } else {
    id = Number((await db.prepare("INSERT INTO guests(name,phone,email,unsub_token) VALUES (?,?,?,?)").run(g.name, phone, email, randomToken(16))).lastInsertRowid);
    const bonus = Number(await getSetting("loyalty_welcome_bonus") || 0);
    if (bonus) await addPoints(id, bonus, "Welcome bonus");
  }
  await setConsent(id, "marketing_email", !!g.consentMarketing, source);
  await setConsent(id, "whatsapp", !!g.consentWhatsapp, source);
  if (g.aadhaar) await storeAadhaar(id, g.aadhaar);
  return id;
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
  const days = Number(await getSetting("aadhaar_retention_days") || 30);
  await db.prepare("UPDATE guests SET aadhaar_enc=?, aadhaar_last4=?, aadhaar_purpose=?, aadhaar_delete_after=? WHERE id=?").run(
    encrypt(d), d.slice(-4), "Guest identity verification at check-in", addDays(today(), days + 365), guestId, // refined on checkout
  );
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
  paid?: number; paymentMethod?: string; notes?: string; status?: string; createdBy?: number; commissionPct?: number;
};

export async function createBooking(i: CreateBookingInput): Promise<{ ok: true; id: number; code: string } | { ok: false; error: string }> {
  if (!isValidDate(i.checkIn) || !isValidDate(i.checkOut) || nightsBetween(i.checkIn, i.checkOut) < 1) return { ok: false, error: "Check-out must be after check-in." };
  const room = await db.prepare("SELECT * FROM rooms WHERE id=? AND active=1").get<{ capacity: number }>(i.roomId);
  if (!room) return { ok: false, error: "Room not available." };
  if (i.adults + i.children > room.capacity) return { ok: false, error: `Room sleeps at most ${room.capacity}.` };
  if (!i.guest.name?.trim()) return { ok: false, error: "Guest name is required." };
  if (!i.guest.phone && !i.guest.email) return { ok: false, error: "Phone or email is required." };
  if (!(await isRoomFree(i.roomId, i.checkIn, i.checkOut))) return { ok: false, error: "Room is not available for those dates." };

  const guestId = await upsertGuest(i.guest, i.source === "website" ? "website_booking" : "dashboard_booking");
  const q = await quote({ roomId: i.roomId, checkIn: i.checkIn, checkOut: i.checkOut, services: i.services, couponCode: i.couponCode, guestId, redeemPoints: i.redeemPoints });
  if (i.couponCode && q.couponError) return { ok: false, error: "Coupon: " + q.couponError };
  const code = "HS-" + new Date().toISOString().slice(2, 7).replace("-", "") + "-" + randomToken(3).toUpperCase();
  const commission = i.commissionPct ? Math.round((q.total * i.commissionPct) / 100) : 0;

  // ATOMIC availability guard: the row is only inserted if no overlapping booking/block exists *at the moment of insert*,
  // so two simultaneous requests (website + owner + OTA) can never both win — works on D1, which has no interactive transactions.
  const ins = await db.prepare(
    `INSERT INTO bookings(code,guest_id,room_id,check_in,check_out,adults,children,status,source,room_amount,services_amount,discount,loyalty_discount,gst,total,paid,payment_method,coupon_code,notes,commission,created_by)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
     WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE room_id=? AND status NOT IN ('cancelled','no_show') AND check_in<? AND check_out>?)
       AND NOT EXISTS (SELECT 1 FROM room_blocks WHERE room_id=? AND start_date<? AND end_date>?)`,
  ).run(code, guestId, i.roomId, i.checkIn, i.checkOut, i.adults, i.children, i.status || "confirmed", i.source, q.roomAmount, q.servicesAmount, q.discount, q.loyaltyDiscount, q.gst, q.total,
    Math.min(i.paid ?? 0, q.total), i.paymentMethod ?? null, q.couponCode ?? null, i.notes ?? null, commission, i.createdBy ?? null,
    i.roomId, i.checkOut, i.checkIn, i.roomId, i.checkOut, i.checkIn);
  if (ins.changes !== 1) return { ok: false, error: "Room is not available for those dates." };
  const id = ins.lastInsertRowid;

  const after: ReturnType<typeof st>[] = [];
  for (const s of i.services || []) {
    const row = await db.prepare("SELECT price,included FROM services WHERE id=?").get<{ price: number; included: number }>(s.id);
    if (row) after.push(st("INSERT INTO booking_services(booking_id,service_id,qty,price) VALUES (?,?,?,?)", id, s.id, s.qty, row.included ? 0 : row.price));
  }
  if (q.couponCode) after.push(st("UPDATE coupons SET used=used+1 WHERE code=? COLLATE NOCASE", q.couponCode));
  if (q.loyaltyDiscount) after.push(...pointsStmts(guestId, -Math.round(q.loyaltyDiscount / Number(await getSetting("loyalty_point_value") || 1)), "Redeemed on " + code, id, i.createdBy));
  await db.batch(after);
  return { ok: true, id, code };
}

/** Cancels the booking and PROPOSES a refund. Money only moves after a human approves it on /refunds. */
export async function cancelBooking(bookingId: number, reason: string, by: number, overridePct?: number) {
  const b = await db.prepare("SELECT * FROM bookings WHERE id=?").get<{ id: number; status: string; paid: number; check_in: string; coupon_code: string | null; guest_id: number }>(bookingId);
  if (!b) throw new Error("Booking not found");
  if (["cancelled", "completed"].includes(b.status)) throw new Error(`Booking is already ${b.status}.`);
  const pol = await refundFor(b.check_in, b.paid);
  const amount = overridePct != null ? Math.round((b.paid * overridePct) / 100) : pol.amount;
  const stmts = [st("UPDATE bookings SET status='cancelled', cancelled_at=datetime('now'), cancel_reason=? WHERE id=?", reason, bookingId)];
  if (b.coupon_code) stmts.push(st("UPDATE coupons SET used=MAX(0,used-1) WHERE code=? COLLATE NOCASE", b.coupon_code));
  if (amount > 0) stmts.push(st("INSERT INTO refunds(booking_id,amount,status,policy_note,proposed_by) VALUES (?,?,'proposed',?,?)", bookingId, amount, overridePct != null ? `Manual override: ${overridePct}% (policy said ${pol.pct}%)` : pol.note, by));
  await db.batch(stmts);
  return { refund: amount, policy: pol };
}

/** Check-out: award loyalty points, queue testimonial request, set Aadhaar deletion date. */
export async function completeBooking(bookingId: number, by: number) {
  const b = await db.prepare("SELECT * FROM bookings WHERE id=?").get<{ id: number; code: string; guest_id: number; total: number; status: string }>(bookingId);
  if (!b || b.status === "completed" || b.status === "cancelled") return;
  const pts = Math.floor((b.total / 100) * Number((await getSetting("loyalty_points_per_100")) || 0));
  const days = Number((await getSetting("aadhaar_retention_days")) || 30);
  await db.batch([
    st("UPDATE bookings SET status='completed' WHERE id=?", bookingId),
    ...(pts > 0 ? pointsStmts(b.guest_id, pts, `Stay ${b.code}`, bookingId, by) : []),
    st("INSERT INTO testimonials(guest_id,booking_id,status,token) VALUES (?,?,'queued',?)", b.guest_id, bookingId, randomToken(12)),
    st("UPDATE guests SET aadhaar_delete_after=? WHERE id=? AND aadhaar_enc IS NOT NULL", addDays(today(), days), b.guest_id),
  ]);
}
