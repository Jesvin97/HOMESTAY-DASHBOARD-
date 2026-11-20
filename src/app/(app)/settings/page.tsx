import { allSettings } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { saveSettingsAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, btn, inputCls } from "@/components/ui";

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; await requireUser("owner");
  const s = await allSettings();
  const pol = (JSON.parse(s.cancellation_policy) as { daysBefore: number; refundPct: number }[]).sort((a, b) => b.daysBefore - a.daysBefore);
  const rows = [0, 1, 2, 3].map((i) => pol[i] ?? { daysBefore: "", refundPct: "" });
  const env = [["SMTP_URL", "Sending email"], ["IMAP_HOST", "Reading complaints from mailbox"], ["RAZORPAYX_KEY_ID", "Live UPI refunds"], ["WEBSITE_API_KEY", "Website → dashboard bookings"], ["DATA_KEY", "Aadhaar encryption"], ["SESSION_SECRET", "Secure sessions"]];
  return (
    <>
      <PageHeader title="Settings" />
      <Flash msg={sp.msg} err={sp.err} />
      <form action={saveSettingsAction} className="grid gap-4 lg:grid-cols-2">
        <Card title="Business">
          <div className="space-y-3">
            <Field label="Property name"><input name="property_name" defaultValue={s.property_name} className={inputCls} /></Field>
            <Field label="Guest phone"><input name="property_phone" defaultValue={s.property_phone} className={inputCls} /></Field>
            <Field label="Business email"><input name="property_email" defaultValue={s.property_email} className={inputCls} /></Field>
            <Field label="GSTIN (if registered)"><input name="gst_number" defaultValue={s.gst_number} className={inputCls} /></Field>
            <Field label="GST method" hint="Slab = 0% up to ₹1,000/night, 12% to ₹7,500, 18% above. Confirm with your CA."><select name="gst_mode" defaultValue={s.gst_mode} className={inputCls}><option value="slab">Slab by nightly rate</option><option value="flat">Flat %</option><option value="none">Not registered (no GST)</option></select></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Flat GST %"><input name="gst_flat_pct" defaultValue={s.gst_flat_pct} className={inputCls} /></Field><Field label="GST % on services"><input name="services_gst_pct" defaultValue={s.services_gst_pct} className={inputCls} /></Field></div>
          </div>
        </Card>
        <Card title="Cancellation & refund policy (drives UPI refund amounts)">
          <p className="mb-2 text-xs text-slate-500">If cancelled at least N days before check-in → refund X% of amount paid. Leave a row blank to skip.</p>
          {rows.map((r, i) => <div key={i} className="mb-2 flex items-center gap-2 text-sm">≥<input name={`p${i}d`} type="number" min={0} defaultValue={r.daysBefore} className={inputCls + " w-20"} />days before → <input name={`p${i}r`} type="number" min={0} max={100} defaultValue={r.refundPct} className={inputCls + " w-20"} />% refund</div>)}
          <p className="text-xs text-slate-500">Always include a row with 0 days, otherwise late cancellations default to 0%.</p>
        </Card>
        <Card title="Booking holds">
          <Field label="Hold an unpaid booking for (hours)" hint="A booking is confirmed only when the FULL amount is received. Bookings with no payment at all are released after this long; part-paid ones are kept for you to decide."><input name="payment_hold_hours" type="number" min={1} max={168} defaultValue={s.payment_hold_hours} className={inputCls} /></Field>
        </Card>
        <Card title="Privacy officer & retention">
          <div className="space-y-3"><Field label="Grievance officer name"><input name="grievance_officer_name" defaultValue={s.grievance_officer_name} className={inputCls} /></Field>
            <Field label="Grievance officer email"><input name="grievance_officer_email" defaultValue={s.grievance_officer_email} className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Aadhaar kept (days after check-out)"><input name="aadhaar_retention_days" type="number" defaultValue={s.aadhaar_retention_days} className={inputCls} /></Field><Field label="Financial records (years)"><input name="data_retention_years" type="number" defaultValue={s.data_retention_years} className={inputCls} /></Field></div></div>
        </Card>
        <Card title="Integrations status (set in server environment)">
          <ul className="space-y-1 text-sm">{env.map(([k, l]) => <li key={k}>{process.env[k] ? "✅" : "⬜"} {l} <code className="text-xs text-slate-400">{k}</code></li>)}</ul>
        </Card>
        <div><button className={btn}>Save settings</button></div>
      </form>
    </>
  );
}
