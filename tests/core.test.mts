import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_FILE = ":memory:";
const { db } = await import("../src/lib/db");
const { quote, refundFor, evaluateCoupon, isRoomFree } = await import("../src/lib/pricing");
const { createBooking, cancelBooking, validAadhaar } = await import("../src/lib/bookings");
const { addDays, today } = await import("../src/lib/dates");

db.prepare("INSERT INTO rooms(name,type,capacity,base_price) VALUES ('R1','Deluxe',2,3000)").run();
db.prepare("INSERT INTO coupons(code,type,value,min_nights,per_guest_once) VALUES ('TEN','percent',10,2,1)").run();
const ci = addDays(today(), 20), co = addDays(ci, 2);
const guest = { name: "Test Guest", phone: "+919000000001", email: "t@example.com" };

test("GST slab: 3000/night → 12%", () => {
  const q = quote({ roomId: 1, checkIn: ci, checkOut: co });
  assert.equal(q.roomAmount, 6000); assert.equal(q.gst, 720); assert.equal(q.total, 6720);
});
test("coupon enforces min nights", () => {
  const r = evaluateCoupon("TEN", { roomId: 1, checkIn: ci, checkOut: addDays(ci, 1), roomAmount: 3000 });
  assert.equal(r.ok, false);
});
test("no double booking", () => {
  const a = createBooking({ roomId: 1, checkIn: ci, checkOut: co, adults: 2, children: 0, source: "direct", guest, paid: 6720 });
  assert.equal(a.ok, true);
  const b = createBooking({ roomId: 1, checkIn: addDays(ci, 1), checkOut: addDays(ci, 3), adults: 2, children: 0, source: "website", guest: { name: "Other", phone: "+919000000002" } });
  assert.equal(b.ok, false);
  assert.equal(isRoomFree(1, co, addDays(co, 1)), true); // back-to-back is fine
});
test("cancellation proposes (never pays) a policy refund", () => {
  const id = (db.prepare("SELECT id FROM bookings LIMIT 1").get() as { id: number }).id;
  const r = cancelBooking(id, "test", 1);
  assert.equal(r.refund, 6720); // 20 days out → 100%
  const rf = db.prepare("SELECT status,amount FROM refunds").get() as { status: string; amount: number };
  assert.equal(rf.status, "proposed");
  assert.equal(isRoomFree(1, ci, co), true); // freed up
});
test("refund tiers", () => {
  assert.equal(refundFor(addDays(today(), 4), 1000).pct, 50);
  assert.equal(refundFor(addDays(today(), 1), 1000).amount, 0);
});
function withCheckDigit(base: string) { // Verhoeff
  const d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const p = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  const inv = [0,4,3,2,1,5,6,7,8,9];
  let c = 0;
  [...base].reverse().forEach((ch, i) => { c = d[c][p[(i + 1) % 8][Number(ch)]]; });
  return base + inv[c];
}
test("Aadhaar checksum", () => {
  assert.equal(validAadhaar(withCheckDigit("23456789012")), true);
  assert.equal(validAadhaar(withCheckDigit("23456789012").slice(0, 11) + "0"), false);
  assert.equal(validAadhaar("123456789012"), false);
  assert.equal(validAadhaar("2345"), false);
});
