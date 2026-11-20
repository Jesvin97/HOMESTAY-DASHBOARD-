import Link from "next/link";
import { notFound } from "next/navigation";
import { db, getSetting } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { tierFor, completedStays } from "@/lib/bookings";
import { updateGuestAction, saveAadhaarAction, revealAadhaarAction, deleteAadhaarAction, eraseGuestAction, createDsrAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, Table, Td, Badge, btn, btnGhost, btnDanger, inputCls } from "@/components/ui";
import { inr, fmtDate } from "@/lib/dates";

export default async function GuestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const u = await requireUser();
  const g = db.prepare("SELECT * FROM guests WHERE id=?").get(id) as { id: number; name: string; phone: string | null; email: string | null; aadhaar_enc: string | null; aadhaar_last4: string | null; aadhaar_delete_after: string | null; consent_marketing: number; consent_whatsapp: number; loyalty_points: number; notes: string | null; erased_at: string | null } | undefined;
  if (!g) notFound();
  const bookings = db.prepare("SELECT b.id,b.code,b.check_in,b.check_out,b.status,b.total,r.name room FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE guest_id=? ORDER BY check_in DESC").all(g.id) as { id: number; code: string; check_in: string; check_out: string; status: string; total: number; room: string }[];
  const consents = db.prepare("SELECT * FROM consents WHERE guest_id=? ORDER BY id DESC LIMIT 10").all(g.id) as { purpose: string; granted: number; source: string; created_at: string; notice_version: string }[];
  const stays = completedStays(g.id);
  if (g.erased_at) return <><PageHeader title="Erased guest" /><p className="text-sm text-slate-600">Personal data was erased on {fmtDate(g.erased_at)}. Booking financials are retained anonymously for tax compliance.</p></>;
  const hid = <input type="hidden" name="id" value={g.id} />;
  return (
    <>
      <PageHeader title={g.name} sub={`${tierFor(stays)} · ${stays} completed stay(s) · ${g.loyalty_points} points`} />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Contact & consent">
          <form action={updateGuestAction} className="space-y-3">{hid}
            <Field label="Name"><input name="name" defaultValue={g.name} required className={inputCls} /></Field>
            <Field label="Phone"><input name="phone" defaultValue={g.phone ?? ""} className={inputCls} /></Field>
            <Field label="Email"><input name="email" type="email" defaultValue={g.email ?? ""} className={inputCls} /></Field>
            <Field label="Notes (preferences — no sensitive data)"><textarea name="notes" defaultValue={g.notes ?? ""} className={inputCls} rows={2} /></Field>
            <label className="flex gap-2 text-sm"><input type="checkbox" name="consent_marketing" defaultChecked={!!g.consent_marketing} /> Opted in to marketing emails</label>
            <label className="flex gap-2 text-sm"><input type="checkbox" name="consent_whatsapp" defaultChecked={!!g.consent_whatsapp} /> OK to message on WhatsApp for feedback</label>
            <button className={btn}>Save</button>
          </form>
          <h3 className="mt-4 text-xs font-semibold uppercase text-slate-500">Consent history</h3>
          <ul className="mt-1 space-y-1 text-xs text-slate-600">{consents.map((c, i) => <li key={i}>{fmtDate(c.created_at)} · {c.purpose.replace("_", " ")} · {c.granted ? "granted" : "withdrawn"} · {c.source} · notice v{c.notice_version}</li>)}</ul>
        </Card>
        <div className="space-y-4">
          <Card title="Aadhaar (optional, encrypted)">
            {g.aadhaar_enc ? (
              <>
                <p className="text-sm">On file: •••• •••• {g.aadhaar_last4}. Auto-deletes on <b>{fmtDate(g.aadhaar_delete_after)}</b>.</p>
                <div className="mt-2 flex gap-2">
                  {can(u, "owner") && <form action={revealAadhaarAction}>{hid}<button className={btnGhost}>Reveal once (logged)</button></form>}
                  <form action={deleteAadhaarAction}>{hid}<button className={btnGhost}>Delete now</button></form>
                </div>
              </>
            ) : (
              <form action={saveAadhaarAction} className="space-y-2">{hid}
                <input name="aadhaar" inputMode="numeric" placeholder="12-digit Aadhaar" className={inputCls} />
                <label className="flex gap-2 text-xs text-slate-600"><input type="checkbox" name="lawful" /> The guest was told why we collect this ID, how long we keep it ({getSetting("aadhaar_retention_days")} days after check-out) and agreed.</label>
                <button className={btnGhost}>Store encrypted</button>
              </form>
            )}
            <p className="mt-2 text-xs text-slate-500">Tip: a masked copy or another ID (passport, driving licence) is usually enough for check-in.</p>
          </Card>
          <Card title="Privacy requests for this guest">
            <div className="flex flex-wrap gap-2 text-sm">
              <a className={btnGhost} href={`/api/guests/${g.id}/export`}>Download their data (JSON)</a>
              <form action={createDsrAction} className="flex gap-1"><input type="hidden" name="guest_id" value={g.id} /><input type="hidden" name="requester" value={g.name} /><input type="hidden" name="type" value="erasure" /><button className={btnGhost}>Log erasure request</button></form>
              {can(u, "owner") && <form action={eraseGuestAction}>{hid}<button className={btnDanger}>Erase personal data now</button></form>}
            </div>
          </Card>
        </div>
      </div>
      <Card title="Booking history" className="mt-4">
        <Table head={["Code", "Room", "Stay", "Status", "Total"]} empty={bookings.length ? undefined : "No bookings."}>
          {bookings.map((b) => <tr key={b.id}><Td><Link className="text-brand-700 hover:underline" href={`/bookings/${b.id}`}>{b.code}</Link></Td><Td>{b.room}</Td><Td>{fmtDate(b.check_in)} → {fmtDate(b.check_out)}</Td><Td><Badge v={b.status} /></Td><Td>{inr(b.total)}</Td></tr>)}
        </Table>
      </Card>
    </>
  );
}
