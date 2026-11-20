import { db } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { saveCampaignAction, approveCampaignAction, sendCampaignAction } from "@/app/actions";
import { segmentGuests } from "@/lib/marketing";
import { Card, Field, Flash, PageHeader, Badge, btn, btnGhost, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/dates";

type C = { id: number; name: string; subject: string; body: string; segment: string; status: string; sent_count: number; sent_at: string | null };
const SEGMENTS = [["all_consented", "All opted-in guests"], ["past_year", "Stayed in last 12 months"], ["lapsed", "Haven't stayed in 12+ months (win-back)"], ["repeat", "Repeat guests"], ["gold", "Top-tier guests"]];

export default async function Marketing({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; const u = await requireUser();
  const camps = db.prepare("SELECT * FROM campaigns ORDER BY id DESC").all() as C[];
  const total = (db.prepare("SELECT COUNT(*) c FROM guests WHERE erased_at IS NULL AND email IS NOT NULL").get() as { c: number }).c;
  const opted = segmentGuests("all_consented").length;
  return (
    <>
      <PageHeader title="Email marketing" sub={`${opted} of ${total} guests with an email have opted in. Only they can ever be emailed.`} />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="New campaign" className="lg:col-span-1">
          <form action={saveCampaignAction} className="space-y-3">
            <Field label="Internal name"><input name="name" required className={inputCls} /></Field>
            <Field label="Audience"><select name="segment" className={inputCls}>{SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l} ({segmentGuests(v).length})</option>)}</select></Field>
            <Field label="Subject"><input name="subject" required className={inputCls} /></Field>
            <Field label="Message" hint="Use {{name}} for the guest's first name. An unsubscribe link is added automatically."><textarea name="body" rows={8} required className={inputCls} /></Field>
            <button className={btn}>Save draft</button>
          </form>
        </Card>
        <div className="space-y-3 lg:col-span-2">
          {camps.map((c) => (
            <Card key={c.id} title={c.name} action={<Badge v={c.status} />}>
              <p className="text-sm font-medium">{c.subject}</p><p className="mt-1 whitespace-pre-line text-sm text-slate-600">{c.body}</p>
              <p className="mt-2 text-xs text-slate-500">Audience: {SEGMENTS.find((s) => s[0] === c.segment)?.[1]} ({segmentGuests(c.segment).length}){c.sent_at && ` · sent ${fmtDate(c.sent_at)} to ${c.sent_count}`}</p>
              <div className="mt-2 flex gap-2">
                {c.status === "draft" && (can(u, "manager") ? <form action={approveCampaignAction}><input type="hidden" name="id" value={c.id} /><button className={btnGhost}>Approve</button></form> : <span className="text-xs text-slate-500">Awaiting manager approval</span>)}
                {c.status === "approved" && can(u, "manager") && <form action={sendCampaignAction}><input type="hidden" name="id" value={c.id} /><button className={btn}>Send to {segmentGuests(c.segment).length} guests</button></form>}
              </div>
            </Card>
          ))}
          {!camps.length && <p className="text-sm text-slate-500">No campaigns yet.</p>}
        </div>
      </div>
    </>
  );
}
