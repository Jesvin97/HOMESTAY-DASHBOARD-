import { db } from "@/lib/db";
import { addComplaintAction, updateComplaintAction, syncInboxAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, Table, Td, Badge, btn, btnGhost, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/dates";

export default async function Inbox({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const complaints = await db.prepare(`SELECT c.*, g.name gname FROM complaints c LEFT JOIN guests g ON g.id=c.guest_id ORDER BY (c.status='resolved'), c.id DESC LIMIT 100`).all() as { id: number; subject: string; body: string | null; severity: string; status: string; source: string; gname: string | null; created_at: string; resolution: string | null }[];
  const mails = await db.prepare("SELECT direction,kind,to_addr,from_addr,subject,status,error,created_at FROM emails ORDER BY id DESC LIMIT 40").all() as { direction: string; kind: string; to_addr: string | null; from_addr: string | null; subject: string; status: string; error: string | null; created_at: string }[];
  const guests = await db.prepare("SELECT id,name FROM guests WHERE erased_at IS NULL ORDER BY name LIMIT 500").all() as { id: number; name: string }[];
  return (
    <>
      <PageHeader title="Inbox & complaints" sub="Complaints from your business mailbox and manual entries; plus a log of every email the system sent." action={<form action={syncInboxAction}><button className={btn}>Sync mailbox</button></form>} />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Complaints" className="lg:col-span-2">
          <Table head={["When", "Guest", "Issue", "Severity", "Status", "Resolve"]} empty={complaints.length ? undefined : "No complaints 🎉"}>
            {complaints.map((c) => (
              <tr key={c.id}><Td className="whitespace-nowrap">{fmtDate(c.created_at)}<div className="text-xs text-slate-500">{c.source}</div></Td><Td>{c.gname ?? "—"}</Td>
                <Td className="max-w-xs"><b>{c.subject}</b><div className="line-clamp-2 text-xs text-slate-600">{c.body}</div></Td><Td><Badge v={c.severity} /></Td><Td><Badge v={c.status} /></Td>
                <Td><form action={updateComplaintAction} className="flex flex-col gap-1"><input type="hidden" name="id" value={c.id} />
                  <select name="status" defaultValue={c.status} className={inputCls}><option value="open">open</option><option value="in_progress">in progress</option><option value="resolved">resolved</option></select>
                  <input name="resolution" defaultValue={c.resolution ?? ""} placeholder="What was done?" className={inputCls} /><button className={btnGhost}>Update</button></form></Td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Log a complaint">
          <form action={addComplaintAction} className="space-y-3">
            <Field label="Guest"><select name="guest_id" className={inputCls}><option value="">— unknown —</option>{guests.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
            <Field label="Subject"><input name="subject" required className={inputCls} /></Field>
            <Field label="Details"><textarea name="body" rows={3} className={inputCls} /></Field>
            <Field label="Severity"><select name="severity" className={inputCls}><option>low</option><option selected>medium</option><option>high</option></select></Field>
            <button className={btn}>Save</button>
          </form>
        </Card>
      </div>
      <Card title="Email log (sent confirmations, cancellations, campaigns, received)" className="mt-4">
        <Table head={["When", "Dir", "Type", "To / From", "Subject", "Status"]} empty={mails.length ? undefined : "No emails yet."}>
          {mails.map((m, i) => <tr key={i}><Td className="whitespace-nowrap">{fmtDate(m.created_at)}</Td><Td>{m.direction}</Td><Td>{m.kind.replace("_", " ")}</Td><Td>{m.direction === "out" ? m.to_addr : m.from_addr}</Td><Td className="max-w-xs truncate">{m.subject}</Td><Td><Badge v={m.status} />{m.error && <div className="text-xs text-rose-700">{m.error}</div>}</Td></tr>)}
        </Table>
      </Card>
    </>
  );
}
