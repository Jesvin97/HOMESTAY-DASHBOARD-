import { db } from "@/lib/db";
import { quote } from "@/lib/pricing";
import { addDays, today, inr, nightsBetween, isValidDate } from "@/lib/dates";
import { isRoomFree } from "@/lib/pricing";
import { createBookingAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, btn, btnGhost, inputCls } from "@/components/ui";

type Room = { id: number; name: string; type: string; capacity: number; base_price: number };

export default async function NewBooking({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ci = isValidDate(sp.check_in || "") ? sp.check_in : addDays(today(), 1);
  const co = isValidDate(sp.check_out || "") && sp.check_out > ci ? sp.check_out : addDays(ci, 1);
  const rooms = await db.prepare("SELECT * FROM rooms WHERE active=1 ORDER BY name").all() as Room[];
  const services = await db.prepare("SELECT * FROM services WHERE active=1 ORDER BY category,name").all() as { id: number; name: string; price: number; included: number; unit: string }[];
  const freeMap = Object.fromEntries(await Promise.all(rooms.map(async (r) => [r.id, await isRoomFree(r.id, ci, co)] as const)));
  const roomId = Number(sp.room_id) || rooms.find((r) => freeMap[r.id])?.id || rooms[0]?.id;
  const svc = (Array.isArray(sp.service) ? sp.service : sp.service ? [sp.service] : []).map((id) => ({ id: Number(id), qty: 1 }));
  const q = roomId ? await quote({ roomId, checkIn: ci, checkOut: co, services: svc, couponCode: sp.coupon }) : null;
  return (
    <>
      <PageHeader title="New booking" sub="Confirmed only when the FULL amount is received; otherwise saved as pending and the room is held for a limited time." />
      <Flash err={sp.err} />
      <form className="mb-4 grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-5" method="get">
        <Field label="Check-in"><input type="date" name="check_in" defaultValue={ci} className={inputCls} /></Field>
        <Field label="Check-out"><input type="date" name="check_out" defaultValue={co} className={inputCls} /></Field>
        <Field label="Room"><select name="room_id" defaultValue={roomId} className={inputCls}>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name} — {freeMap[r.id] ? "free" : "BOOKED"}</option>)}</select></Field>
        <Field label="Coupon"><input name="coupon" defaultValue={sp.coupon} className={inputCls} /></Field>
        <div className="flex items-end"><button className={btnGhost + " w-full"}>Check price</button></div>
      </form>
      {q && (
        <Card title={`Quote — ${q.nights} night(s)`} className="mb-4">
          <dl className="grid max-w-md grid-cols-2 gap-y-1 text-sm">
            <dt>Room</dt><dd className="text-right">{inr(q.roomAmount)}</dd>
            {q.servicesAmount > 0 && <><dt>Services</dt><dd className="text-right">{inr(q.servicesAmount)}</dd></>}
            {q.discount > 0 && <><dt>Coupon {q.couponCode}</dt><dd className="text-right text-emerald-700">−{inr(q.discount)}</dd></>}
            <dt>GST</dt><dd className="text-right">{inr(q.gst)}</dd>
            <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{inr(q.total)}</dd>
          </dl>
          {q.couponError && <p className="mt-2 text-sm text-rose-700">Coupon: {q.couponError}</p>}
          {!freeMap[roomId] && <p className="mt-2 text-sm font-medium text-rose-700">This room is not available for these dates.</p>}
          <p className="mt-1 text-xs text-slate-500">{nightsBetween(ci, co)} night(s) · seasonal rates applied per night</p>
        </Card>
      )}
      <form action={createBookingAction} className="space-y-4">
        <input type="hidden" name="room_id" value={roomId} /><input type="hidden" name="check_in" value={ci} /><input type="hidden" name="check_out" value={co} /><input type="hidden" name="coupon" value={sp.coupon || ""} />
        <Card title="Guest">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Full name"><input name="name" required className={inputCls} /></Field>
            <Field label="Phone"><input name="phone" inputMode="tel" className={inputCls} placeholder="+91…" /></Field>
            <Field label="Email"><input name="email" type="email" className={inputCls} /></Field>
            <Field label="Adults"><input name="adults" type="number" min={1} defaultValue={2} className={inputCls} /></Field>
            <Field label="Children"><input name="children" type="number" min={0} defaultValue={0} className={inputCls} /></Field>
            <Field label="Source"><select name="source" className={inputCls}><option value="direct">Direct / walk-in</option><option value="phone">Phone</option><option value="website">Website</option><option value="airbnb">Airbnb</option><option value="booking_com">Booking.com</option><option value="makemytrip">MakeMyTrip</option></select></Field>
            <Field label="Aadhaar (optional)" hint="Stored encrypted; auto-deleted after the stay. Collect only if you need it for ID verification."><input name="aadhaar" inputMode="numeric" maxLength={14} className={inputCls} /></Field>
            <Field label="Redeem loyalty points"><input name="redeem" type="number" min={0} className={inputCls} /></Field>
            <Field label="Notes"><input name="notes" className={inputCls} /></Field>
          </div>
          <div className="mt-3 space-y-1 text-sm">
            <label className="flex gap-2"><input type="checkbox" name="consent_marketing" /> Guest agreed to receive offers by email (optional, separate from the booking)</label>
            <label className="flex gap-2"><input type="checkbox" name="consent_whatsapp" /> Guest agreed to be contacted on WhatsApp for feedback</label>
          </div>
        </Card>
        {services.length > 0 && (
          <Card title="Add services">
            <div className="grid gap-2 sm:grid-cols-2">{services.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="service" value={s.id} defaultChecked={svc.some((x) => x.id === s.id)} />{s.name} <span className="text-slate-500">{s.included ? "(included)" : `${inr(s.price)} ${s.unit}`}</span>
                <input name={`qty_${s.id}`} type="number" min={1} defaultValue={1} className="ml-auto w-16 rounded border px-1 py-0.5" aria-label={`Quantity for ${s.name}`} /></label>))}</div>
          </Card>
        )}
        <Card title="Payment received now (enter the full total to confirm)">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Amount ₹"><input name="paid" type="number" min={0} defaultValue={0} className={inputCls} /></Field>
            <Field label="Method"><select name="payment_method" className={inputCls}><option value="upi">UPI</option><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank transfer</option><option value="ota">Paid via OTA</option></select></Field>
          </div>
        </Card>
        <button className={btn}>Create booking</button>
      </form>
    </>
  );
}
