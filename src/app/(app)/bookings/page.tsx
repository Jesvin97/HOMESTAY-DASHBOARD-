import Link from "next/link";
import { db } from "@/lib/db";
import { today, inr, fmtDate } from "@/lib/dates";
import { Card, PageHeader, Table, Td, Badge, btn, btnGhost, inputCls } from "@/components/ui";

type Row = { id: number; code: string; name: string; phone: string | null; room: string; check_in: string; check_out: string; status: string; total: number; paid: number; source: string; confirmation_status: string };

export default async function Bookings({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; filter?: string }> }) {
  const sp = await searchParams;
  const view = sp.view || "upcoming";
  const t = today();
  const where = view === "past" ? "b.check_out<=? OR b.status IN ('completed')" : view === "cancelled" ? "b.status='cancelled' AND ?=?" : view === "all" ? "?=?" : "b.check_out>? AND b.status NOT IN ('cancelled','completed')";
  const params: unknown[] = view === "cancelled" || view === "all" ? [1, 1] : [t];
  let sql = `SELECT b.id,b.code,g.name,g.phone,r.name room,b.check_in,b.check_out,b.status,b.total,b.paid,b.source,b.confirmation_status FROM bookings b JOIN guests g ON g.id=b.guest_id JOIN rooms r ON r.id=b.room_id WHERE (${where})`;
  if (view === "past") sql += " AND b.status!='cancelled'";
  if (sp.filter === "unsent") sql += " AND b.status IN ('confirmed','pending') AND b.confirmation_status IN ('not_sent','failed')";
  if (sp.q) { sql += " AND (g.name LIKE ? OR g.phone LIKE ? OR b.code LIKE ? OR g.email LIKE ?)"; const l = `%${sp.q}%`; params.push(l, l, l, l); }
  sql += view === "past" || view === "all" || view === "cancelled" ? " ORDER BY b.check_in DESC LIMIT 300" : " ORDER BY b.check_in LIMIT 300";
  const rows = db.prepare(sql).all(...params) as Row[];
  const tabs = [["upcoming", "Upcoming"], ["past", "Past"], ["cancelled", "Cancelled"], ["all", "All"]];
  return (
    <>
      <PageHeader title="Bookings" action={<Link href="/bookings/new" className={btn}>+ New booking</Link>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tabs.map(([v, l]) => <Link key={v} href={`/bookings?view=${v}`} className={view === v ? btn : btnGhost}>{l}</Link>)}
        <form className="ml-auto flex gap-2"><input type="hidden" name="view" value={view} /><input name="q" defaultValue={sp.q} placeholder="Search name, phone, code" className={inputCls + " w-64"} /><button className={btnGhost}>Search</button></form>
      </div>
      <Card>
        <Table head={["Code", "Guest", "Room", "Stay", "Status", "Total", "Paid", "Source", "Email"]} empty={rows.length ? undefined : "Nothing here."}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <Td><Link className="font-medium text-brand-700 hover:underline" href={`/bookings/${r.id}`}>{r.code}</Link></Td>
              <Td>{r.name}<div className="text-xs text-slate-500">{r.phone}</div></Td><Td>{r.room}</Td>
              <Td className="whitespace-nowrap">{fmtDate(r.check_in)} → {fmtDate(r.check_out)}</Td>
              <Td><Badge v={r.status} /></Td><Td>{inr(r.total)}</Td>
              <Td className={r.paid < r.total && r.status !== "cancelled" ? "text-amber-700" : ""}>{inr(r.paid)}</Td>
              <Td className="capitalize">{r.source.replace("_", ".")}</Td><Td><Badge v={r.confirmation_status} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
