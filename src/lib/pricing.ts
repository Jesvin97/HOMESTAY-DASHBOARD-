import { db, getSetting } from "./db";
import { eachNight, nightsBetween, today } from "./dates";

export type Room = { id: number; name: string; type: string; capacity: number; base_price: number; active: number };
export type Coupon = {
  id: number; code: string; type: "percent" | "flat"; value: number; max_discount: number | null; min_nights: number; min_amount: number;
  valid_from: string | null; valid_to: string | null; stay_from: string | null; stay_to: string | null; blackout_dates: string | null;
  room_types: string | null; max_uses: number | null; used: number; per_guest_once: number; first_time_only: number; weekdays_only: number; active: number;
};

export function nightlyRate(roomId: number, date: string): number {
  const r = db.prepare(
    "SELECT price FROM room_rates WHERE room_id=? AND start_date<=? AND end_date>=? ORDER BY priority DESC, id DESC LIMIT 1",
  ).get(roomId, date, date) as { price: number } | undefined;
  if (r) return r.price;
  return (db.prepare("SELECT base_price FROM rooms WHERE id=?").get(roomId) as { base_price: number }).base_price;
}

/** Indian hotel GST slab on per-night tariff (configurable; verify with your CA). */
export function gstPctForRate(rate: number): number {
  const mode = getSetting("gst_mode");
  if (mode === "none") return 0;
  if (mode === "flat") return Number(getSetting("gst_flat_pct")) || 0;
  if (rate <= 1000) return 0;
  if (rate <= 7500) return 12;
  return 18;
}

export function isRoomFree(roomId: number, checkIn: string, checkOut: string, ignoreBookingId?: number): boolean {
  const b = db.prepare(
    `SELECT 1 FROM bookings WHERE room_id=? AND status NOT IN ('cancelled','no_show') AND check_in<? AND check_out>? AND id IS NOT ? LIMIT 1`,
  ).get(roomId, checkOut, checkIn, ignoreBookingId ?? null);
  if (b) return false;
  const k = db.prepare("SELECT 1 FROM room_blocks WHERE room_id=? AND start_date<? AND end_date>? LIMIT 1").get(roomId, checkOut, checkIn);
  return !k;
}

export type CouponResult = { ok: true; discount: number; coupon: Coupon } | { ok: false; error: string };

export function evaluateCoupon(code: string, ctx: { roomId: number; checkIn: string; checkOut: string; roomAmount: number; guestId?: number | null }): CouponResult {
  const c = db.prepare("SELECT * FROM coupons WHERE code=? COLLATE NOCASE").get(code.trim()) as Coupon | undefined;
  if (!c || !c.active) return { ok: false, error: "Coupon not found or inactive." };
  const t = today();
  const nights = nightsBetween(ctx.checkIn, ctx.checkOut);
  if (c.valid_from && t < c.valid_from) return { ok: false, error: `Coupon starts on ${c.valid_from}.` };
  if (c.valid_to && t > c.valid_to) return { ok: false, error: "Coupon has expired." };
  if (c.stay_from && ctx.checkIn < c.stay_from) return { ok: false, error: `Valid for stays from ${c.stay_from}.` };
  if (c.stay_to && ctx.checkOut > c.stay_to) return { ok: false, error: `Valid for stays up to ${c.stay_to}.` };
  if (c.max_uses != null && c.used >= c.max_uses) return { ok: false, error: "Coupon usage limit reached." };
  if (nights < c.min_nights) return { ok: false, error: `Minimum ${c.min_nights} nights required.` };
  if (ctx.roomAmount < c.min_amount) return { ok: false, error: `Minimum room amount ₹${c.min_amount} required.` };
  const room = db.prepare("SELECT type FROM rooms WHERE id=?").get(ctx.roomId) as { type: string };
  if (c.room_types) {
    const allowed = c.room_types.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(room.type.toLowerCase())) return { ok: false, error: `Only for: ${c.room_types}.` };
  }
  const nightsList = eachNight(ctx.checkIn, ctx.checkOut);
  if (c.blackout_dates) {
    const black = c.blackout_dates.split(",").map((s) => s.trim());
    const hit = nightsList.find((n) => black.includes(n));
    if (hit) return { ok: false, error: `Not valid on blackout date ${hit}.` };
  }
  if (c.weekdays_only && nightsList.some((n) => [5, 6].includes(new Date(n + "T00:00:00Z").getUTCDay())))
    return { ok: false, error: "Valid only for Sun–Thu nights." };
  if (ctx.guestId) {
    if (c.per_guest_once && db.prepare("SELECT 1 FROM bookings WHERE guest_id=? AND coupon_code=? COLLATE NOCASE AND status!='cancelled'").get(ctx.guestId, c.code))
      return { ok: false, error: "You have already used this coupon." };
    if (c.first_time_only && db.prepare("SELECT 1 FROM bookings WHERE guest_id=? AND status IN ('completed','checked_in','confirmed')").get(ctx.guestId))
      return { ok: false, error: "Only for first-time guests." };
  }
  let d = c.type === "percent" ? Math.round((ctx.roomAmount * c.value) / 100) : c.value;
  if (c.max_discount != null) d = Math.min(d, c.max_discount);
  d = Math.min(d, ctx.roomAmount);
  return { ok: true, discount: d, coupon: c };
}

export type Quote = {
  nights: number; roomAmount: number; servicesAmount: number; discount: number; loyaltyDiscount: number;
  gst: number; total: number; couponError?: string; couponCode?: string; perNight: { date: string; rate: number }[];
};

export function quote(a: {
  roomId: number; checkIn: string; checkOut: string; services?: { id: number; qty: number }[];
  couponCode?: string | null; guestId?: number | null; redeemPoints?: number;
}): Quote {
  const perNight = eachNight(a.checkIn, a.checkOut).map((date) => ({ date, rate: nightlyRate(a.roomId, date) }));
  const roomAmount = perNight.reduce((s, n) => s + n.rate, 0);
  let servicesAmount = 0;
  for (const s of a.services || []) {
    const row = db.prepare("SELECT price,included FROM services WHERE id=? AND active=1").get(s.id) as { price: number; included: number } | undefined;
    if (row && !row.included) servicesAmount += row.price * Math.max(1, s.qty);
  }
  let discount = 0, couponError: string | undefined, couponCode: string | undefined;
  if (a.couponCode?.trim()) {
    const r = evaluateCoupon(a.couponCode, { roomId: a.roomId, checkIn: a.checkIn, checkOut: a.checkOut, roomAmount, guestId: a.guestId });
    if (r.ok) { discount = r.discount; couponCode = r.coupon.code; } else couponError = r.error;
  }
  let loyaltyDiscount = 0;
  if (a.guestId && a.redeemPoints && a.redeemPoints > 0) {
    const g = db.prepare("SELECT loyalty_points FROM guests WHERE id=?").get(a.guestId) as { loyalty_points: number } | undefined;
    const pts = Math.min(a.redeemPoints, g?.loyalty_points ?? 0);
    loyaltyDiscount = Math.min(Math.round(pts * Number(getSetting("loyalty_point_value") || 1)), roomAmount - discount);
  }
  const roomNet = Math.max(0, roomAmount - discount - loyaltyDiscount);
  const factor = roomAmount ? roomNet / roomAmount : 0;
  const roomGst = perNight.reduce((s, n) => s + n.rate * (gstPctForRate(n.rate) / 100), 0) * factor;
  const svcGst = servicesAmount * (Number(getSetting("services_gst_pct")) / 100);
  const gst = Math.round(roomGst + svcGst);
  return { nights: perNight.length, roomAmount, servicesAmount, discount, loyaltyDiscount, gst, total: roomNet + servicesAmount + gst, couponError, couponCode, perNight };
}

export type PolicyTier = { daysBefore: number; refundPct: number };
/** Refund = tier % of amount paid, based on days between today and check-in. */
export function refundFor(checkIn: string, paid: number, asOf = today()) {
  const tiers = (JSON.parse(getSetting("cancellation_policy") || "[]") as PolicyTier[]).sort((a, b) => b.daysBefore - a.daysBefore);
  const days = nightsBetween(asOf, checkIn);
  const tier = tiers.find((t) => days >= t.daysBefore) ?? { daysBefore: 0, refundPct: 0 };
  return { pct: tier.refundPct, amount: Math.round((paid * tier.refundPct) / 100), days, note: `${days} day(s) before check-in → ${tier.refundPct}% refund per policy` };
}
