import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_FILE = ":memory:";
const { db } = await import("../src/lib/db");
const { quote, refundFor, evaluateCoupon, isRoomFree } = await import("../src/lib/pricing");
const { createBooking, cancelBooking, validAadhaar } = await import("../src/lib/bookings");
const { addDays, today } = await import("../src/lib/dates");
const mfa = await import("../src/lib/mfa");
const B = await import("../src/lib/bookings");

await db.prepare("INSERT INTO rooms(name,type,capacity,base_price) VALUES ('R1','Deluxe',2,3000)").run();
await db.prepare("INSERT INTO coupons(code,type,value,min_nights,per_guest_once) VALUES ('TEN','percent',10,2,1)").run();
const ci = addDays(today(), 20), co = addDays(ci, 2);
const guest = { name: "Test Guest", phone: "+919000000001", email: "t@example.com" };
const base = { roomId: 1, adults: 2, children: 0, source: "direct" };

test("GST slab: 3000/night → 12%", async () => {
  const q = await quote({ roomId: 1, checkIn: ci, checkOut: co });
  assert.equal(q.roomAmount, 6000); assert.equal(q.gst, 720); assert.equal(q.total, 6720);
});
test("seasonal rate overrides base price per night", async () => {
  await db.prepare("INSERT INTO room_rates(room_id,label,start_date,end_date,price,priority) VALUES (1,'Peak',?,?,5000,1)").run(addDays(ci, 1), addDays(ci, 5));
  const q = await quote({ roomId: 1, checkIn: ci, checkOut: co });
  assert.equal(q.roomAmount, 3000 + 5000);
  await db.prepare("DELETE FROM room_rates").run();
});
test("coupon enforces min nights", async () => {
  assert.equal((await evaluateCoupon("TEN", { roomId: 1, checkIn: ci, checkOut: addDays(ci, 1), roomAmount: 3000 })).ok, false);
  assert.equal((await evaluateCoupon("TEN", { roomId: 1, checkIn: ci, checkOut: co, roomAmount: 6000 })).ok, true);
});
test("two simultaneous requests for the same room: exactly one wins", async () => {
  const mk = (name: string, phone: string) => createBooking({ ...base, checkIn: ci, checkOut: co, guest: { name, phone }, paid: 6720 });
  const res = await Promise.all([mk("A", "+919000000001"), mk("B", "+919000000002")]);
  assert.equal(res.filter((r) => r.ok).length, 1);
  assert.equal((await createBooking({ ...base, checkIn: addDays(ci, 1), checkOut: addDays(ci, 3), source: "website", guest: { name: "C", phone: "+919000000003" } })).ok, false);
  assert.equal(await isRoomFree(1, co, addDays(co, 1)), true); // back-to-back is fine
});
test("cancellation proposes (never pays) a policy refund and frees the room", async () => {
  const { id } = (await db.prepare("SELECT id FROM bookings LIMIT 1").get()) as { id: number };
  const r = await cancelBooking(id, "test", 1);
  assert.equal(r.refund, 6720);
  const rf = (await db.prepare("SELECT status,amount FROM refunds").get()) as { status: string; amount: number };
  assert.equal(rf.status, "proposed");
  assert.equal(await isRoomFree(1, ci, co), true);
  await assert.rejects(cancelBooking(id, "again", 1)); // can't cancel twice
});
test("refund tiers", async () => {
  assert.equal((await refundFor(addDays(today(), 4), 1000)).pct, 50);
  assert.equal((await refundFor(addDays(today(), 1), 1000)).amount, 0);
});
function withCheckDigit(b: string) { // Verhoeff
  const d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const p = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  const inv = [0,4,3,2,1,5,6,7,8,9]; let c = 0;
  [...b].reverse().forEach((ch, i) => { c = d[c][p[(i + 1) % 8][Number(ch)]]; });
  return b + inv[c];
}
test("Aadhaar checksum", () => {
  assert.equal(validAadhaar(withCheckDigit("23456789012")), true);
  assert.equal(validAadhaar(withCheckDigit("23456789012").slice(0, 11) + "0"), false);
  assert.equal(validAadhaar("123456789012"), false);
});

/* ---- MFA ---- */
const RFC_SECRET = mfa.b32encode(Buffer.from("12345678901234567890"));
test("TOTP matches RFC 6238 vector (t=59 → …287082)", () => {
  assert.equal(mfa.totpAt(RFC_SECRET, 59_000), "287082");
  assert.equal(mfa.totpAt(RFC_SECRET, 1111111109_000), "081804");
});
test("TOTP: accepts ±1 step, rejects far-off and replayed codes", () => {
  const t = 1_700_000_000_000, code = mfa.totpAt(RFC_SECRET, t);
  const step = mfa.verifyTotp(RFC_SECRET, code, 0, t);
  assert.ok(step);
  assert.ok(mfa.verifyTotp(RFC_SECRET, code, 0, t + 29_000)); // clock drift ok
  assert.equal(mfa.verifyTotp(RFC_SECRET, code, step!, t), null);       // replay blocked
  assert.equal(mfa.verifyTotp(RFC_SECRET, code, 0, t + 120_000), null); // too old
  assert.equal(mfa.verifyTotp(RFC_SECRET, "12345", 0, t), null);
  assert.equal(mfa.verifyTotp(RFC_SECRET, "abcdef", 0, t), null);
});
test("backup codes are single-use and stored hashed", () => {
  const { plain, hashed } = mfa.newBackupCodes();
  assert.equal(plain.length, 10); assert.ok(!hashed.includes(plain[0]));
  const left = mfa.consumeBackupCode(hashed, plain[3].toUpperCase());
  assert.equal(left?.length, 9);
  assert.equal(mfa.consumeBackupCode(left!, plain[3]), null);
  assert.equal(mfa.consumeBackupCode(left!, "nope-nope0"), null);
});

/* ---- payment-gated confirmation & audit regressions ---- */
const far = addDays(today(), 90);
test("RULE: booking is PENDING until the full amount is received", async () => {
  const r = await createBooking({ ...base, checkIn: far, checkOut: addDays(far, 1), guest: { name: "Pay Later", phone: "+919000000010" }, paid: 100 });
  assert.ok(r.ok && r.status === "pending");
  const id = (r as { id: number }).id;
  const p1 = await B.recordPayment(id, 50, "upi"); assert.ok(p1.ok && !p1.confirmed);
  assert.equal(((await db.prepare("SELECT status FROM bookings WHERE id=?").get(id)) as { status: string }).status, "pending");
  const over = await B.recordPayment(id, 1e7, "upi"); assert.equal(over.ok, false);
  const total = ((await db.prepare("SELECT total,paid FROM bookings WHERE id=?").get(id)) as { total: number; paid: number });
  const p2 = await B.recordPayment(id, total.total - total.paid, "upi"); assert.ok(p2.ok && p2.confirmed);
  assert.equal(((await db.prepare("SELECT status FROM bookings WHERE id=?").get(id)) as { status: string }).status, "confirmed");
});
test("full payment at creation → confirmed immediately", async () => {
  const r = await createBooking({ ...base, checkIn: addDays(far, 5), checkOut: addDays(far, 6), guest: { name: "Pay Now", phone: "+919000000011" }, paid: 1e9 });
  assert.ok(r.ok && r.status === "confirmed");
});
test("a cancelled/completed booking can't take payment; pending can't be checked out", async () => {
  const r = await createBooking({ ...base, checkIn: addDays(far, 10), checkOut: addDays(far, 11), guest: { name: "X", phone: "+919000000012" }, paid: 0 });
  const id = (r as { id: number }).id;
  await B.completeBooking(id, 1); // pending → must be ignored
  assert.equal(((await db.prepare("SELECT status FROM bookings WHERE id=?").get(id)) as { status: string }).status, "pending");
  await cancelBooking(id, "t", 1);
  assert.equal((await B.recordPayment(id, 10, "upi")).ok, false);
  await assert.rejects(cancelBooking(id, "again", 1));
});
test("unpaid holds are released after the hold window; partially paid ones are kept", async () => {
  const a = (await createBooking({ ...base, checkIn: addDays(far, 20), checkOut: addDays(far, 21), guest: { name: "Old Unpaid", phone: "+919000000013" }, paid: 0 })) as { id: number };
  const b = (await createBooking({ ...base, checkIn: addDays(far, 22), checkOut: addDays(far, 23), guest: { name: "Old Part", phone: "+919000000014" }, paid: 100 })) as { id: number };
  await db.prepare("UPDATE bookings SET created_at=datetime('now','-30 hours') WHERE id IN (?,?)").run(a.id, b.id);
  assert.equal(await B.expireUnpaidHolds(), 1);
  const st = async (id: number) => ((await db.prepare("SELECT status FROM bookings WHERE id=?").get(id)) as { status: string }).status;
  assert.equal(await st(a.id), "cancelled"); assert.equal(await st(b.id), "pending");
  assert.equal(await isRoomFree(1, addDays(far, 20), addDays(far, 21)), true);
});
test("refund override outside 0–100 is rejected", async () => {
  const r = (await createBooking({ ...base, checkIn: addDays(far, 30), checkOut: addDays(far, 31), guest: { name: "Ovr", phone: "+919000000015" }, paid: 1e9 })) as { id: number };
  await assert.rejects(cancelBooking(r.id, "t", 1, 500));
});
test("a repeat booking never withdraws consent or renames the guest", async () => {
  await createBooking({ ...base, checkIn: addDays(far, 40), checkOut: addDays(far, 41), guest: { name: "Real Name", phone: "+919000000016", email: "c@example.com", consentMarketing: true }, paid: 0 });
  await createBooking({ ...base, checkIn: addDays(far, 42), checkOut: addDays(far, 43), guest: { name: "Imposter", phone: "+919000000016", consentMarketing: false }, paid: 0 });
  const g = (await db.prepare("SELECT name,consent_marketing FROM guests WHERE phone='+919000000016'").get()) as { name: string; consent_marketing: number };
  assert.equal(g.name, "Real Name"); assert.equal(g.consent_marketing, 1);
});
test("redeemed loyalty points come back when the booking is cancelled", async () => {
  await db.prepare("UPDATE guests SET loyalty_points=500 WHERE phone='+919000000016'").run();
  const gid = ((await db.prepare("SELECT id FROM guests WHERE phone='+919000000016'").get()) as { id: number }).id;
  const r = (await createBooking({ ...base, checkIn: addDays(far, 50), checkOut: addDays(far, 52), guest: { name: "Real Name", phone: "+919000000016" }, paid: 0, redeemPoints: 200 })) as { id: number };
  assert.equal(((await db.prepare("SELECT loyalty_points p FROM guests WHERE id=?").get(gid)) as { p: number }).p, 300);
  await cancelBooking(r.id, "t", 1);
  assert.equal(((await db.prepare("SELECT loyalty_points p FROM guests WHERE id=?").get(gid)) as { p: number }).p, 500);
});
test("'today' follows the property timezone (IST), not UTC", async () => {
  const { today: t, TZ } = await import("../src/lib/dates");
  assert.equal(TZ, "Asia/Kolkata");
  assert.equal(t(), new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
});
