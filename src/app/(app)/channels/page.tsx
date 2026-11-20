import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { saveChannelAction, syncChannelAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, btn, btnGhost, inputCls } from "@/components/ui";
import { inr } from "@/lib/dates";
import { bySource } from "@/lib/stats";

export default async function Channels({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; await requireUser("manager");
  const rooms = db.prepare("SELECT id,name FROM rooms WHERE active=1").all() as { id: number; name: string }[];
  const ch = db.prepare("SELECT * FROM channels ORDER BY id").all() as { id: number; name: string; commission_pct: number; room_id: number | null; ical_url: string | null; last_sync: string | null; last_result: string | null }[];
  const src = bySource();
  const base = process.env.APP_URL || "http://localhost:3000";
  return (
    <>
      <PageHeader title="Channels: Airbnb, Booking.com, MakeMyTrip" sub="Two-way iCal sync keeps one availability calendar so the same night can't be sold twice." />
      <Flash msg={sp.msg} err={sp.err} />
      <Card title="Commission cost by source (last bookings)">
        <ul className="grid gap-1 text-sm sm:grid-cols-2">{src.map((s) => <li key={s.source} className="capitalize">{s.source.replace("_", ".")}: {inr(s.revenue)} revenue, <b>{inr(s.commission)}</b> commission ({s.bookings} bookings)</li>)}</ul>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {ch.map((c) => (
          <Card key={c.id} title={c.name}>
            <form action={saveChannelAction} className="space-y-2"><input type="hidden" name="id" value={c.id} />
              <input name="name" defaultValue={c.name} className={inputCls} />
              <select name="room_id" defaultValue={c.room_id ?? ""} className={inputCls}><option value="">Select room…</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
              <input name="commission_pct" type="number" step="0.5" defaultValue={c.commission_pct} className={inputCls} aria-label="Commission %" />
              <input name="ical_url" defaultValue={c.ical_url ?? ""} placeholder="https://… iCal export URL from the OTA" className={inputCls} />
              <button className={btnGhost}>Save</button></form>
            <form action={syncChannelAction} className="mt-2"><input type="hidden" name="id" value={c.id} /><button className={btn}>Sync now</button></form>
            <p className="mt-1 text-xs text-slate-500">{c.last_sync ? `Last: ${c.last_sync} — ${c.last_result}` : "Never synced"}</p>
            {c.room_id && <p className="mt-2 break-all text-xs text-slate-500">Give the OTA this export link: <code>{base}/api/ical/{c.room_id}?token=ICAL_TOKEN</code></p>}
          </Card>))}
        <Card title="Add a channel">
          <form action={saveChannelAction} className="space-y-2"><input name="name" placeholder="airbnb / booking_com / makemytrip" required className={inputCls} />
            <select name="room_id" className={inputCls}><option value="">Select room…</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            <input name="commission_pct" type="number" step="0.5" placeholder="Commission %" className={inputCls} /><input name="ical_url" placeholder="iCal URL" className={inputCls} /><button className={btn}>Add</button></form>
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-500">iCal sync runs when you press Sync (or schedule a call to this action). It's not instant — OTAs refresh iCal every few hours — so for high-volume use, move to a channel manager API.</p>
    </>
  );
}
