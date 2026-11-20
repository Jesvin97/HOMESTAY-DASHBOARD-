import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { saveRoomAction, addRateAction, deleteRateAction, addPhotoAction, editPhotoAction, deletePhotoAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, btn, btnGhost, inputCls } from "@/components/ui";
import { inr, fmtDate } from "@/lib/dates";

type Room = { id: number; name: string; type: string; capacity: number; base_price: number; description: string | null; active: number };
type Rate = { id: number; room_id: number; label: string; start_date: string; end_date: string; price: number; priority: number };
type Photo = { id: number; room_id: number | null; url: string; caption: string | null; is_hero: number; sort: number };

export default async function Rooms({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; await requireUser("manager");
  const rooms = await db.prepare("SELECT * FROM rooms ORDER BY id").all() as Room[];
  const rates = await db.prepare("SELECT * FROM room_rates ORDER BY start_date").all() as Rate[];
  const photos = await db.prepare("SELECT * FROM photos ORDER BY is_hero DESC, sort, id").all() as Photo[];
  return (
    <>
      <PageHeader title="Rooms, pricing & photos" sub="Edit base prices, add peak/off-season rates, manage the photos shown on the website." />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="grid gap-4 lg:grid-cols-2">
        {rooms.map((r) => (
          <Card key={r.id} title={r.name}>
            <form action={saveRoomAction} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="id" value={r.id} />
              <Field label="Name"><input name="name" defaultValue={r.name} className={inputCls} /></Field>
              <Field label="Type"><input name="type" defaultValue={r.type} className={inputCls} /></Field>
              <Field label="Sleeps"><input name="capacity" type="number" min={1} defaultValue={r.capacity} className={inputCls} /></Field>
              <Field label="Base price / night ₹" hint="Price changes are written to the audit log."><input name="base_price" type="number" min={1} defaultValue={r.base_price} className={inputCls} /></Field>
              <div className="sm:col-span-2"><Field label="Description"><textarea name="description" defaultValue={r.description ?? ""} rows={2} className={inputCls} /></Field></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={!!r.active} /> Bookable</label>
              <button className={btn}>Save room</button>
            </form>
            <h3 className="mt-4 text-xs font-semibold uppercase text-slate-500">Seasonal rates (highest priority wins)</h3>
            <ul className="mt-1 space-y-1 text-sm">{rates.filter((x) => x.room_id === r.id).map((x) => <li key={x.id} className="flex items-center justify-between">
              <span>{x.label}: {fmtDate(x.start_date)} – {fmtDate(x.end_date)} → <b>{inr(x.price)}</b></span>
              <form action={deleteRateAction}><input type="hidden" name="id" value={x.id} /><button className="text-xs text-rose-600 hover:underline">remove</button></form></li>)}</ul>
            <form action={addRateAction} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5"><input type="hidden" name="room_id" value={r.id} />
              <input name="label" placeholder="Peak / Off" className={inputCls} /><input type="date" name="start_date" required className={inputCls} /><input type="date" name="end_date" required className={inputCls} />
              <input name="price" type="number" min={1} placeholder="₹" required className={inputCls} /><button className={btnGhost}>Add rate</button><input type="hidden" name="priority" value="1" /></form>
          </Card>
        ))}
        <Card title="Add a new room">
          <form action={saveRoomAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input name="name" required className={inputCls} /></Field><Field label="Type"><input name="type" placeholder="Deluxe" className={inputCls} /></Field>
            <Field label="Sleeps"><input name="capacity" type="number" defaultValue={2} className={inputCls} /></Field><Field label="Price / night ₹"><input name="base_price" type="number" required className={inputCls} /></Field>
            <button className={btn}>Add room</button>
          </form>
        </Card>
      </div>
      <Card title="Photos (website gallery)" className="mt-4">
        <p className="mb-3 text-xs text-slate-500">Paste the HTTPS URL of an uploaded image (e.g. from your CDN / Cloudinary / S3). Mark one as the hero (Taj-style banner).</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {photos.map((p) => (
            <div key={p.id} className="rounded-lg border p-2 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption || "Property photo"} className="mb-2 h-28 w-full rounded object-cover bg-slate-100" />
              <form action={editPhotoAction} className="space-y-1"><input type="hidden" name="id" value={p.id} /><input name="caption" defaultValue={p.caption ?? ""} className={inputCls} placeholder="Caption / alt text" />
                <div className="flex items-center gap-2"><label><input type="checkbox" name="is_hero" defaultChecked={!!p.is_hero} /> hero</label><input name="sort" type="number" defaultValue={p.sort} className="w-14 rounded border px-1" aria-label="Sort order" /><button className={btnGhost}>Save</button></div></form>
              <form action={deletePhotoAction}><input type="hidden" name="id" value={p.id} /><button className="mt-1 text-rose-600 hover:underline">delete</button></form>
            </div>))}
        </div>
        <form action={addPhotoAction} className="mt-4 grid gap-2 sm:grid-cols-5">
          <input name="url" placeholder="https://…/photo.jpg" required className={inputCls + " sm:col-span-2"} /><input name="caption" placeholder="Caption" className={inputCls} />
          <select name="room_id" className={inputCls}><option value="">Property / general</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <button className={btn}>Add photo</button><label className="text-xs"><input type="checkbox" name="is_hero" /> hero image</label>
        </form>
      </Card>
    </>
  );
}
