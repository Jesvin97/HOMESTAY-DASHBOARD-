import { db, getSetting } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { createDsrAction, closeDsrAction, logBreachAction, runRetentionAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, Table, Td, Badge, btn, btnGhost, inputCls } from "@/components/ui";
import { fmtDate, today } from "@/lib/dates";

export default async function Privacy({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; const u = await requireUser("manager");
  const dsr = db.prepare("SELECT d.*, g.name gname FROM dsr_requests d LEFT JOIN guests g ON g.id=d.guest_id ORDER BY (d.status='done'), d.due_date LIMIT 100").all() as { id: number; type: string; status: string; due_date: string; requester: string | null; gname: string | null; notes: string | null }[];
  const breaches = db.prepare("SELECT * FROM breaches ORDER BY id DESC").all() as { id: number; discovered_at: string; description: string; people_affected: number; authority_notified: number; individuals_notified: number }[];
  const stats = db.prepare(`SELECT (SELECT COUNT(*) FROM guests WHERE aadhaar_enc IS NOT NULL) aadhaar, (SELECT COUNT(*) FROM guests WHERE consent_marketing=1) mkt, (SELECT COUNT(*) FROM guests WHERE erased_at IS NOT NULL) erased`).get() as { aadhaar: number; mkt: number; erased: number };
  const checks = [
    ["Grievance officer named (DPDP s.8(10) / GDPR contact)", !!getSetting("grievance_officer_email")],
    ["Encryption key set (DATA_KEY)", !!process.env.DATA_KEY],
    ["Session secret set", !!process.env.SESSION_SECRET],
    ["HTTPS-only cookies in production", process.env.NODE_ENV === "production"],
    ["No overdue data-subject requests", !dsr.some((d) => d.status === "open" && d.due_date < today())],
  ] as const;
  return (
    <>
      <PageHeader title="Privacy: DPDP Act 2023 & GDPR" sub="Consent records, data-subject requests, retention and breach register." />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Compliance checklist"><ul className="space-y-1 text-sm">{checks.map(([l, ok]) => <li key={l}>{ok ? "✅" : "⚠️"} {l}</li>)}</ul>
          <p className="mt-3 text-xs text-slate-500">{stats.aadhaar} Aadhaar record(s) held · {stats.mkt} marketing opt-ins · {stats.erased} erasures done</p></Card>
        <Card title="Retention">
          <p className="text-sm text-slate-600">Aadhaar is deleted {getSetting("aadhaar_retention_days")} days after check-out. Booking/financial records are kept {getSetting("data_retention_years")} years for tax law, then reviewed.</p>
          <form action={runRetentionAction} className="mt-3"><button className={btnGhost}>Run retention clean-up now</button></form>
        </Card>
        <Card title="What we do (for your privacy notice)">
          <ul className="list-disc pl-4 text-xs text-slate-600"><li>Collect only what a booking needs; marketing & WhatsApp are separate, unticked opt-ins.</li><li>Every consent change is time-stamped with the notice version.</li><li>Aadhaar stored AES-256-GCM encrypted, reveal is owner-only and logged.</li><li>Access, correction, erasure and withdrawal requests tracked with deadlines.</li><li>Erasure anonymises the person but keeps tax records.</li></ul>
        </Card>
      </div>
      <Card title="Data-subject requests" className="mt-4">
        <Table head={["Type", "Who", "Due", "Status", "Close"]} empty={dsr.length ? undefined : "No requests."}>
          {dsr.map((d) => (<tr key={d.id}><Td className="capitalize">{d.type.replace("_", " ")}</Td><Td>{d.gname ?? d.requester}</Td><Td className={d.status === "open" && d.due_date < today() ? "font-semibold text-rose-700" : ""}>{fmtDate(d.due_date)}</Td><Td><Badge v={d.status === "done" ? "resolved" : "open"} /></Td>
            <Td>{d.status === "open" && <form action={closeDsrAction} className="flex gap-1"><input type="hidden" name="id" value={d.id} /><input name="outcome" placeholder="Outcome" className={inputCls} required /><button className={btnGhost}>Close</button></form>}</Td></tr>))}
        </Table>
        <form action={createDsrAction} className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-5">
          <select name="type" className={inputCls}><option value="access">Access my data</option><option value="correction">Correct my data</option><option value="erasure">Erase my data</option><option value="withdraw_consent">Withdraw consent</option><option value="grievance">Grievance</option><option value="nominate">Nominate (DPDP)</option></select>
          <input name="requester" placeholder="Name / email of requester" required className={inputCls + " sm:col-span-2"} /><input name="notes" placeholder="Notes" className={inputCls} /><button className={btn}>Log request</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Deadlines: 30 days (GDPR: one month); grievances 15 days (DPDP Rules guidance). Check the current rules with your lawyer.</p>
      </Card>
      {can(u, "owner") && (
        <Card title="Breach register" className="mt-4">
          <ul className="mb-3 space-y-1 text-sm">{breaches.map((b) => <li key={b.id}>{fmtDate(b.discovered_at)} — {b.description} ({b.people_affected} people) · authority {b.authority_notified ? "✓" : "✗"} · individuals {b.individuals_notified ? "✓" : "✗"}</li>)}</ul>
          <form action={logBreachAction} className="grid gap-2 sm:grid-cols-4"><input type="date" name="discovered_at" defaultValue={today()} className={inputCls} /><input name="description" placeholder="What happened" required className={inputCls + " sm:col-span-2"} /><input name="people_affected" type="number" placeholder="# people" className={inputCls} />
            <input name="data_affected" placeholder="Data types" className={inputCls} /><input name="remediation" placeholder="Action taken" className={inputCls + " sm:col-span-2"} />
            <label className="text-xs"><input type="checkbox" name="authority" /> Authority notified</label><label className="text-xs"><input type="checkbox" name="individuals" /> People notified</label><button className={btn}>Record breach</button></form>
          <p className="mt-2 text-xs text-slate-500">GDPR requires notifying the supervisory authority within 72 hours; DPDP requires intimating the Data Protection Board and affected people.</p>
        </Card>
      )}
    </>
  );
}
