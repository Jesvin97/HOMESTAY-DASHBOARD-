// The website-facing booking flow: availability, holds, payment, double-booking, cancellation and refunds.
// Cashfree is replaced by a stand-in server, so nothing real is called.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.DATABASE_FILE = ":memory:";
process.env.CASHFREE_APP_ID = "test_app";
process.env.CASHFREE_SECRET_KEY = "test_secret";

// ---- stand-in Cashfree (refunds only) ----
type RefundCall = { order: string; body: { refund_amount: number; refund_id: string } };
const refundCalls: RefundCall[] = [];
const refunds = new Map<string, { refund_id: string; cf_refund_id: number; refund_status: string; refund_amount: number }>();
let nextRefundStatus = "SUCCESS";
let failRefunds = false;
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const m = req.url!.match(/^\/orders\/([^/]+)\/refunds(?:\/([^/]+))?$/);
    res.setHeader("Content-Type", "application/json");
    if (!m) { res.statusCode = 404; return res.end("{}"); }
    if (req.method === "POST") {
      if (failRefunds) { res.statusCode = 500; return res.end(JSON.stringify({ message: "down" })); }
      const body = JSON.parse(raw);
      refundCalls.push({ order: m[1], body });
      const r = { refund_id: body.refund_id, cf_refund_id: 700 + refundCalls.length, refund_status: nextRefundStatus, refund_amount: body.refund_amount };
      refunds.set(`${m[1]}/${body.refund_id}`, r);
      return res.end(JSON.stringify(r));
    }
    const r = refunds.get(`${m[1]}/${m[2]}`);
    if (!r) { res.statusCode = 404; return res.end("{}"); }
    return res.end(JSON.stringify(r));
  });
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
process.env.CASHFREE_API_BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const { db, getSetting } = await import("../src/lib/db");
const { seedWebsiteCatalog } = await import("../src/lib/catalog");
const O = await import("../src/lib/onlineBookings");
const { addDays, today } = await import("../src/lib/dates");
const { sign, verifySigned } = await import("../src/lib/signedApi");
await seedWebsiteCatalog();

const PHONE = "9876543210";
const stay = (days: number, nights = 2) => ({ checkIn: addDays(today(), days), checkOut: addDays(today(), days + nights), adults: 2, children: 0, plan: "bb" as const });
const guest = { name: "Asha Nair", phone: PHONE, email: "asha@example.com" };
async function hold(room: string, days: number, nights = 2, extra: Record<string, unknown> = {}) {
  return O.createHold({ roomSlug: room, ...stay(days, nights), consent: true, noticeVersion: "2026-11-b", guest, ...extra } as never);
}
let orderSeq = 9000;
async function holdAndPay(room: string, days: number, nights = 2) {
  const h = await hold(room, days, nights);
  assert.equal(h.ok, true, JSON.stringify(h));
  if (!h.ok) throw new Error("hold failed");
  const orderId = String(++orderSeq);
  assert.equal((await O.attachProviderOrder(h.code, orderId)).ok, true);
  const paid = await O.applyOnlinePayment(h.code, { orderId, paymentId: "pay_" + orderId, amount: h.total });
  assert.equal(paid.ok && paid.outcome, "confirmed");
  return { code: h.code, total: h.total, orderId };
}

test("catalog: 4 rooms, same-day booking allowed, past dates refused", async () => {
  const a = await O.availability(stay(0), [], undefined);
  assert.equal(a.ok, true);
  if (a.ok) assert.deepEqual(a.rooms.map((r) => r.slug), ["heritage-room", "plantation-cottage", "family-suite", "whole-home"]);
  const past = await O.availability({ ...stay(0), checkIn: addDays(today(), -1) }, [], undefined);
  assert.equal(past.ok, false);
});

test("prices match the website: ₹4,500 x 2 nights + 5% GST = ₹9,450; all meals; extra adult; add-on; coupon", async () => {
  const p = async (over: Record<string, unknown> = {}, svc: string[] = [], coupon?: string) => {
    const r = await O.priceQuote("heritage-room", { ...stay(30), ...over } as never, svc, coupon);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.ok ? r.quote : null!;
  };
  assert.equal((await p()).total, 9450);
  assert.equal((await p({ plan: "meals" })).total, Math.round(2 * (4500 + 1700) * 1.05)); // 13,020
  assert.equal((await p({ adults: 3 })).total, Math.round((9000 + 2 * 1200) * 1.05)); // one adult over the base of 2
  assert.equal((await p({}, ["pickup"])).total, Math.round((9000 + 1800) * 1.05));
  assert.equal((await p({}, [], "DIRECT10")).total, Math.round((9000 - 900) * 1.05));
  assert.equal((await O.priceQuote("heritage-room", stay(30), ["nope"])).ok, false); // an unknown add-on is an error
});

test("two guests cannot take the same room and dates; the whole home clashes with every room", async () => {
  const a = await hold("heritage-room", 60);
  const b = await hold("heritage-room", 60);
  assert.equal(a.ok, true);
  assert.equal(b.ok && "x", false);
  if (!b.ok) assert.equal(b.status, 409);
  const w = await hold("whole-home", 61); // overlaps the heritage hold by one night
  assert.equal(w.ok, false);
  const av = await O.availability(stay(60), [], undefined);
  if (av.ok) assert.deepEqual(av.rooms.filter((r) => !r.available).map((r) => r.slug).sort(), ["heritage-room", "whole-home"]);
  // back-to-back is fine
  assert.equal((await hold("heritage-room", 62)).ok, true);
});

test("a held room shows as booked, and a released hold opens the dates at once", async () => {
  const h = await hold("plantation-cottage", 70);
  assert.equal(h.ok, true);
  if (!h.ok) return;
  const r1 = await O.bookedRanges("plantation-cottage", today());
  assert.ok(r1.ok && r1.booked.some((x) => x.from === addDays(today(), 70)));
  await O.releaseHold(h.code);
  const r2 = await O.bookedRanges("plantation-cottage", today());
  assert.ok(r2.ok && !r2.booked.some((x) => x.from === addDays(today(), 70)));
  assert.equal((await hold("plantation-cottage", 70)).ok, true);
});

test("payment: wrong amount and wrong order are refused; paying twice is harmless", async () => {
  const h = await hold("family-suite", 80);
  if (!h.ok) throw new Error("hold");
  await O.attachProviderOrder(h.code, "8001");
  assert.equal((await O.applyOnlinePayment(h.code, { orderId: "8001", paymentId: "p1", amount: h.total - 1 })).ok, false);
  assert.equal((await O.applyOnlinePayment(h.code, { orderId: "9999", paymentId: "p1", amount: h.total })).ok, false);
  const ok = await O.applyOnlinePayment(h.code, { orderId: "8001", paymentId: "p1", amount: h.total });
  assert.equal(ok.ok && ok.outcome, "confirmed");
  const again = await O.applyOnlinePayment(h.code, { orderId: "8001", paymentId: "p1", amount: h.total });
  assert.equal(again.ok && again.outcome, "already_confirmed");
  const b = await O.publicBooking(h.code);
  assert.ok(b.ok && b.booking.confirmed && b.booking.paid === h.total && b.booking.phoneLast4 === "3210" && b.booking.guestFirstName === "Asha");
});

test("someone pays after their hold lapsed and another guest took the dates: refunded in full, no double booking", async () => {
  const first = await hold("heritage-room", 90);
  if (!first.ok) throw new Error("hold");
  await O.attachProviderOrder(first.code, "8101");
  await db.prepare("UPDATE bookings SET hold_expires_at=datetime('now','-1 minutes') WHERE code=?").run(first.code); // hold lapses
  const second = await holdAndPay("heritage-room", 90); // another guest takes and pays for the same dates
  const before = refundCalls.length;
  const late = await O.applyOnlinePayment(first.code, { orderId: "8101", paymentId: "late1", amount: first.total });
  assert.equal(late.ok && late.outcome, "refunded");
  assert.equal(refundCalls.length, before + 1);
  assert.equal(refundCalls.at(-1)!.body.refund_amount, first.total); // everything back
  const live = await db.prepare("SELECT COUNT(*) c FROM bookings WHERE room_id=(SELECT id FROM rooms WHERE slug='heritage-room') AND status IN ('confirmed','pending') AND check_in=?").get<{ c: number }>(addDays(today(), 90));
  assert.equal(live!.c, 1); // exactly one booking holds those dates
  assert.ok(second.code);
  // reporting the same late payment again does not refund twice
  await O.applyOnlinePayment(first.code, { orderId: "8101", paymentId: "late1", amount: first.total });
  assert.equal(refundCalls.length, before + 1);
});

test("a lapsed hold whose dates are still free is confirmed when the guest pays", async () => {
  const h = await hold("plantation-cottage", 100);
  if (!h.ok) throw new Error("hold");
  await O.attachProviderOrder(h.code, "8201");
  await db.prepare("UPDATE bookings SET hold_expires_at=datetime('now','-5 minutes') WHERE code=?").run(h.code);
  const p = await O.applyOnlinePayment(h.code, { orderId: "8201", paymentId: "p2", amount: h.total });
  assert.equal(p.ok && p.outcome, "confirmed");
});

test("cancel: needs the right phone number; refund % follows days before check-in; refunded once only", async () => {
  const cases: [number, number][] = [[40, 75], [16, 75], [15, 50], [3, 50], [2, 0], [0, 0]];
  let ran = 0;
  for (const [daysBefore, pct] of cases) {
    const room = ["heritage-room", "plantation-cottage", "family-suite"][cases.findIndex((c) => c[0] === daysBefore) % 3];
    // stay starts `daysBefore` days from today; separate rooms/dates per case
    const startDays = daysBefore;
    const h = await hold(room, startDays + 0, 2, { guest: { ...guest } });
    assert.ok(h.ok, `hold for the ${daysBefore}-day case failed: ${JSON.stringify(h)}`);
    if (!h.ok) continue;
    ran++;
    await O.attachProviderOrder(h.code, String(++orderSeq));
    const paid = await O.applyOnlinePayment(h.code, { orderId: String(orderSeq), paymentId: "pay_" + orderSeq, amount: h.total });
    assert.equal(paid.ok && paid.outcome, "confirmed");

    assert.equal((await O.lookupForGuest(h.code, "9000000000")).ok, false); // wrong phone
    const look = await O.lookupForGuest(h.code, PHONE);
    assert.ok(look.ok && look.cancel.percent === pct && look.cancel.canCancel);
    const before = refundCalls.length;
    const c = await O.cancelByGuest(h.code, PHONE);
    assert.ok(c.ok, JSON.stringify(c));
    if (!c.ok) continue;
    const expected = Math.floor((h.total * pct) / 100);
    assert.equal(c.refund, Math.round((h.total * pct) / 100));
    assert.equal(refundCalls.length, before + (pct > 0 ? 1 : 0));
    if (pct > 0) assert.equal(refundCalls.at(-1)!.body.refund_amount, c.refund);
    assert.ok(Math.abs(c.refund - expected) <= 1);
    // a second cancel (double click) does not refund again
    const again = await O.cancelByGuest(h.code, PHONE);
    assert.ok(again.ok && again.alreadyCancelled);
    assert.equal(refundCalls.length, before + (pct > 0 ? 1 : 0));
    // the dates are open again
    assert.equal((await O.availability(stay(startDays), [], undefined)).ok, true);
  }
  assert.equal(ran, cases.length); // every case really ran
});

test("cancelling frees the dates for other guests straight away", async () => {
  const x = await holdAndPay("family-suite", 130);
  assert.equal((await hold("family-suite", 130)).ok, false);
  const c = await O.cancelByGuest(x.code, PHONE);
  assert.ok(c.ok);
  assert.equal((await hold("family-suite", 130)).ok, true);
});

test("a stay that has already started cannot be cancelled online", async () => {
  const h = await holdAndPay("plantation-cottage", 140);
  await db.prepare("UPDATE bookings SET check_in=?, check_out=? WHERE code=?").run(addDays(today(), -1), addDays(today(), 1), h.code);
  const c = await O.cancelByGuest(h.code, PHONE);
  assert.equal(c.ok, false);
});

test("if Cashfree is down the cancellation still happens and the refund can be retried", async () => {
  const h = await holdAndPay("heritage-room", 150);
  failRefunds = true;
  const c = await O.cancelByGuest(h.code, PHONE);
  assert.ok(c.ok && c.refundStatus === "failed");
  failRefunds = false;
  const retry = await O.cancelByGuest(h.code, PHONE); // the guest (or a manager) tries again
  assert.ok(retry.ok && retry.alreadyCancelled && retry.refundStatus === "paid");
  const n = refundCalls.filter((r) => r.order === h.code).length;
  assert.equal(n, 1); // only one refund ever reached Cashfree
});

test("with automatic refunds off, the cancellation waits for a manager", async () => {
  await db.prepare("UPDATE settings SET value='0' WHERE key='auto_refund_online'").run();
  const h = await holdAndPay("heritage-room", 160);
  const before = refundCalls.length;
  const c = await O.cancelByGuest(h.code, PHONE);
  assert.ok(c.ok && c.refundStatus === "awaiting_approval");
  assert.equal(refundCalls.length, before);
  await db.prepare("UPDATE settings SET value='1' WHERE key='auto_refund_online'").run();
  assert.equal(await getSetting("auto_refund_online"), "1");
});

test("callback requests need consent", async () => {
  assert.equal((await O.createLead({ name: "Ravi", phone: PHONE, consent: false, noticeVersion: "x" })).ok, false);
  assert.equal((await O.createLead({ name: "Ravi", phone: PHONE, consent: true, noticeVersion: "x" })).ok, true);
  assert.equal((await db.prepare("SELECT COUNT(*) c FROM leads").get<{ c: number }>())!.c, 1);
});

// ---- signed requests ----
process.env.WEBSITE_API_SECRET = "s".repeat(40);
const mk = (over: { ts?: string; nonce?: string; secret?: string; method?: string; path?: string; body?: string; sigBody?: string } = {}) => {
  const ts = over.ts ?? String(Math.floor(Date.now() / 1000));
  const nonce = over.nonce ?? "n" + Math.random().toString(36).slice(2).padEnd(20, "x");
  const method = over.method ?? "POST";
  const path = over.path ?? "/api/public/quote?x=1";
  const body = over.body ?? '{"a":1}';
  const signature = sign(over.secret ?? process.env.WEBSITE_API_SECRET!, ts, nonce, method, path, over.sigBody ?? body);
  return { req: new Request("http://dash.test" + path, { method, body, headers: { "x-timestamp": ts, "x-nonce": nonce, "x-signature": signature } }), body, nonce };
};

test("signed requests: valid ones pass; tampered, wrong-key, expired and replayed ones do not", async () => {
  const good = mk();
  assert.equal((await verifySigned(good.req, good.body)).ok, true);
  const replay = new Request(good.req.url, { method: "POST", body: good.body, headers: good.req.headers });
  assert.equal((await verifySigned(replay, good.body)).ok, false); // same nonce again
  const tampered = mk({ sigBody: '{"a":2}' }); // body changed after signing
  assert.equal((await verifySigned(tampered.req, tampered.body)).ok, false);
  const wrongKey = mk({ secret: "x".repeat(40) });
  assert.equal((await verifySigned(wrongKey.req, wrongKey.body)).ok, false);
  const old = mk({ ts: String(Math.floor(Date.now() / 1000) - 3600) });
  assert.equal((await verifySigned(old.req, old.body)).ok, false);
  const noHeaders = new Request("http://dash.test/api/public/quote", { method: "POST", body: "{}" });
  assert.equal((await verifySigned(noHeaders, "{}")).ok, false);
  const otherPath = mk({ path: "/api/public/quote?x=1" });
  const moved = new Request("http://dash.test/api/public/cancel", { method: "POST", body: otherPath.body, headers: otherPath.req.headers }); // signature was for another path
  assert.equal((await verifySigned(moved, otherPath.body)).ok, false);
});

test.after(() => server.close());
