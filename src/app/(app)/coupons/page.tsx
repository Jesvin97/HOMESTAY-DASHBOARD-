import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { saveCouponAction, toggleCouponAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, Table, Td, Badge, btn, btnGhost, inputCls } from "@/components/ui";
import { inr } from "@/lib/dates";

type C = { id: number; code: string; description: string | null; type: string; value: number; max_discount: number | null; min_nights: number; min_amount: number; valid_from: string | null; valid_to: string | null; stay_from: string | null; stay_to: string | null; blackout_dates: string | null; room_types: string | null; max_uses: number | null; used: number; per_guest_once: number; first_time_only: number; weekdays_only: number; terms: string | null; active: number };

function rules(c: C) {
  const r: string[] = [];
  r.push(c.type === "percent" ? `${c.value}% off room tariff${c.max_discount ? ` (max ${inr(c.max_discount)})` : ""}` : `${inr(c.value)} off`);
  if (c.min_nights > 1) r.push(`min ${c.min_nights} nights`); if (c.min_amount) r.push(`min room amount ${inr(c.min_amount)}`);
  if (c.valid_from || c.valid_to) r.push(`book ${c.valid_from ?? "…"} to ${c.valid_to ?? "…"}`);
  if (c.stay_from || c.stay_to) r.push(`stay ${c.stay_from ?? "…"} to ${c.stay_to ?? "…"}`);
  if (c.room_types) r.push(`rooms: ${c.room_types}`); if (c.weekdays_only) r.push("Sun–Thu only"); if (c.per_guest_once) r.push("once per guest"); if (c.first_time_only) r.push("first-time guests");
  if (c.blackout_dates) r.push(`not valid: ${c.blackout_dates}`); if (c.max_uses) r.push(`limited to ${c.max_uses} uses`);
  return r.join(" · ");
}

export default async function Coupons({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; await requireUser("manager");
  const coupons = await db.prepare("SELECT * FROM coupons ORDER BY active DESC, id DESC").all() as C[];
  return (
    <>
      <PageHeader title="Coupon codes" sub="Every rule below is enforced automatically at booking time — owner, staff and website all use the same engine." />
      <Flash msg={sp.msg} err={sp.err} />
      <Card title="Create / update a coupon">
        <form action={saveCouponAction} className="grid gap-3 sm:grid-cols-4">
          <Field label="Code"><input name="code" required className={inputCls + " uppercase"} placeholder="TEA20" /></Field>
          <Field label="Type"><select name="type" className={inputCls}><option value="percent">Percent %</option><option value="flat">Flat ₹</option></select></Field>
          <Field label="Value"><input name="value" type="number" min={1} required className={inputCls} /></Field>
          <Field label="Max discount ₹"><input name="max_discount" type="number" className={inputCls} /></Field>
          <Field label="Min nights"><input name="min_nights" type="number" min={1} defaultValue={1} className={inputCls} /></Field>
          <Field label="Min room amount ₹"><input name="min_amount" type="number" defaultValue={0} className={inputCls} /></Field>
          <Field label="Max total uses"><input name="max_uses" type="number" className={inputCls} /></Field>
          <Field label="Room types (comma)"><input name="room_types" placeholder="Deluxe, Suite" className={inputCls} /></Field>
          <Field label="Bookable from"><input type="date" name="valid_from" className={inputCls} /></Field>
          <Field label="Bookable until"><input type="date" name="valid_to" className={inputCls} /></Field>
          <Field label="Stay from"><input type="date" name="stay_from" className={inputCls} /></Field>
          <Field label="Stay until (check-out)"><input type="date" name="stay_to" className={inputCls} /></Field>
          <div className="sm:col-span-4"><Field label="Blackout dates (YYYY-MM-DD, comma separated)"><input name="blackout_dates" className={inputCls} placeholder="2026-12-24,2026-12-31" /></Field></div>
          <div className="sm:col-span-4"><Field label="Terms shown to guests"><input name="terms" className={inputCls} /></Field></div>
          <div className="flex flex-wrap gap-4 text-sm sm:col-span-4">
            <label><input type="checkbox" name="per_guest_once" /> Once per guest</label><label><input type="checkbox" name="first_time_only" /> First-time guests only</label><label><input type="checkbox" name="weekdays_only" /> Sun–Thu nights only</label>
          </div>
          <button className={btn}>Save coupon</button>
        </form>
      </Card>
      <Card title="Existing coupons" className="mt-4">
        <Table head={["Code", "Rules", "Used", "Status", ""]} empty={coupons.length ? undefined : "No coupons yet."}>
          {coupons.map((c) => (<tr key={c.id}><Td className="font-mono font-semibold">{c.code}</Td><Td className="max-w-lg text-xs text-slate-600">{rules(c)}{c.terms && <div className="mt-1 italic">{c.terms}</div>}</Td><Td>{c.used}{c.max_uses ? ` / ${c.max_uses}` : ""}</Td>
            <Td><Badge v={c.active ? "confirmed" : "cancelled"} /></Td><Td><form action={toggleCouponAction}><input type="hidden" name="id" value={c.id} /><button className={btnGhost}>{c.active ? "Disable" : "Enable"}</button></form></Td></tr>))}
        </Table>
      </Card>
    </>
  );
}
