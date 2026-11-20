import { db } from "@/lib/db";
import { addDays, today, fmtDate } from "@/lib/dates";
import { blockRoomAction, unblockAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, btn, btnGhost, inputCls } from "@/components/ui";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ from?: string; msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from || "") ? sp.from! : today();
  const days = Array.from({ length: 28 }, (_, i) => addDays(from, i));
  const end = addDays(from, 28);
  const rooms = db.prepare("SELECT id,name FROM rooms WHERE active=1").all() as { id: number; name: string }[];
  const bks = db.prepare("SELECT room_id,check_in,check_out,code,status FROM bookings WHERE status IN ('pending','confirmed','checked_in') AND check_in<? AND check_out>?").all(end, from) as { room_id: number; check_in: string; check_out: string; code: string; status: string }[];
  const blocks = db.prepare("SELECT id,room_id,start_date,end_date,reason,source FROM room_blocks WHERE start_date<? AND end_date>?").all(end, from) as { id: number; room_id: number; start_date: string; end_date: string; reason: string; source: string }[];
  const cell = (rid: number, d: string) => {
    const b = bks.find((x) => x.room_id === rid && x.check_in <= d && x.check_out > d);
    if (b) return { c: b.status === "pending" ? "bg-amber-300" : "bg-brand-500", t: b.code };
    const k = blocks.find((x) => x.room_id === rid && x.start_date <= d && x.end_date > d);
    if (k) return { c: k.source === "ota" ? "bg-purple-400" : "bg-slate-400", t: `${k.source}: ${k.reason}` };
    return { c: "bg-slate-100", t: "free" };
  };
  return (
    <>
      <PageHeader title="Availability" sub="One shared calendar for website, walk-ins and OTAs — that's how double bookings are prevented." />
      <Flash msg={sp.msg} err={sp.err} />
      <Card>
        <div className="mb-3 flex gap-2"><a className={btnGhost} href={`/calendar?from=${addDays(from, -28)}`}>← Earlier</a><a className={btnGhost} href={`/calendar?from=${addDays(from, 28)}`}>Later →</a>
          <span className="ml-auto flex items-center gap-3 text-xs"><i className="inline-block h-3 w-3 rounded bg-brand-500" /> booked <i className="inline-block h-3 w-3 rounded bg-amber-300" /> pending <i className="inline-block h-3 w-3 rounded bg-slate-400" /> blocked <i className="inline-block h-3 w-3 rounded bg-purple-400" /> OTA</span></div>
        <div className="overflow-x-auto"><table className="text-xs"><thead><tr><th className="w-32 text-left">Room</th>{days.map((d) => <th key={d} className="px-0.5 font-normal text-slate-500">{d.slice(8)}</th>)}</tr></thead>
          <tbody>{rooms.map((r) => <tr key={r.id}><td className="py-0.5 pr-2 font-medium">{r.name}</td>{days.map((d) => { const c = cell(r.id, d); return <td key={d} className="p-0.5"><div title={`${d}: ${c.t}`} className={`h-5 w-5 rounded ${c.c}`} /></td>; })}</tr>)}</tbody></table></div>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Block dates (maintenance, family use)">
          <form action={blockRoomAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Room"><select name="room_id" className={inputCls}>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Reason"><input name="reason" className={inputCls} /></Field>
            <Field label="From"><input type="date" name="start_date" required className={inputCls} /></Field>
            <Field label="Until (checkout day)"><input type="date" name="end_date" required className={inputCls} /></Field>
            <button className={btn}>Block</button>
          </form>
        </Card>
        <Card title="Active blocks">
          <ul className="space-y-1 text-sm">{blocks.filter((b) => b.source === "manual").map((b) => <li key={b.id} className="flex items-center justify-between">{rooms.find((r) => r.id === b.room_id)?.name}: {fmtDate(b.start_date)} → {fmtDate(b.end_date)} ({b.reason})
            <form action={unblockAction}><input type="hidden" name="id" value={b.id} /><button className="text-xs text-rose-600 hover:underline">remove</button></form></li>)}</ul>
        </Card>
      </div>
    </>
  );
}
