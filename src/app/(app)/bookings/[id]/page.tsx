import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { refundFor } from "@/lib/pricing";
import { inr, fmtDate, nightsBetween } from "@/lib/dates";
import { sendConfirmationAction, recordPaymentAction, bookingStatusAction, cancelBookingAction } from "@/app/actions";
import { Card, Flash, PageHeader, Badge, btn, btnGhost, btnDanger, inputCls, Field } from "@/components/ui";

type B = { id: number; code: string; guest_id: number; gname: string; phone: string | null; email: string | null; room: string; check_in: string; check_out: string; adults: number; children: number; status: string; source: string; room_amount: number; services_amount: number; discount: number; loyalty_discount: number; gst: number; total: number; paid: number; coupon_code: string | null; notes: string | null; confirmation_status: string; confirmation_sent_at: string | null; cancel_reason: string | null; commission: number };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const b = await db.prepare(`SELECT b.*, g.name gname, g.phone, g.email, r.name room FROM bookings b JOIN guests g ON g.id=b.guest_id JOIN rooms r ON r.id=b.room_id WHERE b.id=?`).get(id) as B | undefined;
  if (!b) notFound();
  const svc = await db.prepare("SELECT s.name, bs.qty, bs.price FROM booking_services bs JOIN services s ON s.id=bs.service_id WHERE bs.booking_id=?").all(b.id) as { name: string; qty: number; price: number }[];
  const refunds = await db.prepare("SELECT * FROM refunds WHERE booking_id=?").all(b.id) as { id: number; amount: number; status: string; policy_note: string }[];
  const mails = await db.prepare("SELECT kind,status,to_addr,created_at,error FROM emails WHERE booking_id=? ORDER BY id DESC").all(b.id) as { kind: string; status: string; to_addr: string; created_at: string; error: string | null }[];
  const active = !["cancelled", "completed", "no_show"].includes(b.status);
  const pol = active ? await refundFor(b.check_in, b.paid) : null;
  const hid = <input type="hidden" name="id" value={b.id} />;
  return (
    <>
      <PageHeader title={`Booking ${b.code}`} sub={`${b.room} · ${fmtDate(b.check_in)} → ${fmtDate(b.check_out)} (${nightsBetween(b.check_in, b.check_out)} nights)`} action={<Badge v={b.status} />} />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Guest">
          <Link href={`/guests/${b.guest_id}`} className="font-medium text-brand-700 hover:underline">{b.gname}</Link>
          <div className="text-sm text-slate-600">{b.phone || "no phone"}<br />{b.email || "no email"}</div>
          <div className="mt-2 text-sm">{b.adults} adults, {b.children} children · via <span className="capitalize">{b.source.replace("_", ".")}</span></div>
          {b.notes && <p className="mt-2 text-sm text-slate-600">Note: {b.notes}</p>}
        </Card>
        <Card title="Money">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt>Room</dt><dd className="text-right">{inr(b.room_amount)}</dd>
            {svc.map((s) => <><dt key={s.name}>{s.name} ×{s.qty}</dt><dd className="text-right">{inr(s.price * s.qty)}</dd></>)}
            {b.discount > 0 && <><dt>Coupon {b.coupon_code}</dt><dd className="text-right text-emerald-700">−{inr(b.discount)}</dd></>}
            {b.loyalty_discount > 0 && <><dt>Loyalty points</dt><dd className="text-right text-emerald-700">−{inr(b.loyalty_discount)}</dd></>}
            <dt>GST</dt><dd className="text-right">{inr(b.gst)}</dd>
            <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{inr(b.total)}</dd>
            <dt>Paid</dt><dd className="text-right">{inr(b.paid)}</dd>
            <dt>Balance</dt><dd className={`text-right ${b.total - b.paid > 0 && active ? "font-medium text-amber-700" : ""}`}>{inr(b.total - b.paid)}</dd>
            {b.commission > 0 && <><dt className="text-slate-500">OTA commission</dt><dd className="text-right text-slate-500">{inr(b.commission)}</dd></>}
          </dl>
          {active && b.total > b.paid && (
            <form action={recordPaymentAction} className="mt-3 flex gap-2">{hid}
              <input name="amount" type="number" min={1} max={b.total - b.paid} placeholder="₹ received" className={inputCls} required />
              <select name="method" className={inputCls + " w-28"}><option value="upi">UPI</option><option value="cash">Cash</option><option value="card">Card</option></select>
              <button className={btnGhost}>Record</button>
            </form>
          )}
        </Card>
        <Card title="Confirmation email">
          <div className="mb-2 flex items-center gap-2 text-sm"><Badge v={b.confirmation_status} />{b.confirmation_sent_at && <span className="text-slate-500">{fmtDate(b.confirmation_sent_at)}</span>}</div>
          {b.email ? <form action={sendConfirmationAction}>{hid}<button className={btn}>{b.confirmation_status === "sent" ? "Resend" : "Send"} confirmation</button></form> : <p className="text-sm text-amber-700">Guest has no email — add one on the guest page.</p>}
          <ul className="mt-3 space-y-1 text-xs text-slate-500">{mails.map((m, i) => <li key={i}>{m.kind.replace("_", " ")} → {m.to_addr} · {m.status}{m.error ? ` (${m.error})` : ""}</li>)}</ul>
        </Card>
      </div>

      {active && (
        <Card title="Status" className="mt-4">
          <div className="flex flex-wrap gap-2">
            {b.status === "pending" && <form action={bookingStatusAction}>{hid}<input type="hidden" name="to" value="confirmed" /><button className={btn}>Confirm booking</button></form>}
            {b.status === "confirmed" && <form action={bookingStatusAction}>{hid}<input type="hidden" name="to" value="checked_in" /><button className={btn}>Check in</button></form>}
            {["confirmed", "checked_in"].includes(b.status) && <form action={bookingStatusAction}>{hid}<input type="hidden" name="to" value="completed" /><button className={btn}>Check out (awards loyalty points)</button></form>}
            {b.status === "confirmed" && <form action={bookingStatusAction}>{hid}<input type="hidden" name="to" value="no_show" /><button className={btnGhost}>Mark no-show</button></form>}
          </div>
        </Card>
      )}

      {active && pol && (
        <Card title="Cancel booking" className="mt-4">
          <p className="mb-3 text-sm text-slate-600">Policy: <b>{pol.note}</b> → proposed refund <b>{inr(pol.amount)}</b> of {inr(b.paid)} paid. Cancelling does <u>not</u> send money — the refund appears under Refunds for a human to approve.</p>
          <form action={cancelBookingAction} className="grid max-w-2xl gap-3 sm:grid-cols-2">{hid}
            <Field label="Reason"><input name="reason" required className={inputCls} /></Field>
            <Field label="Override refund % (manager only, optional)"><input name="override_pct" type="number" min={0} max={100} className={inputCls} placeholder={`policy: ${pol.pct}`} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="notify" defaultChecked /> Email the guest about the cancellation</label>
            <div className="sm:col-span-2"><button className={btnDanger}>Cancel booking &amp; propose refund</button></div>
          </form>
        </Card>
      )}
      {b.status === "cancelled" && <Card title="Cancelled" className="mt-4"><p className="text-sm">Reason: {b.cancel_reason}</p>{refunds.map((r) => <p key={r.id} className="mt-1 text-sm">Refund {inr(r.amount)} <Badge v={r.status} /> — {r.policy_note}</p>)}</Card>}
    </>
  );
}
