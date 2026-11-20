import { db, getSetting } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { adjustPointsAction, saveLoyaltySettingsAction } from "@/app/actions";
import { loadTiers, tierName } from "@/lib/bookings";
import { Card, Field, Flash, PageHeader, Table, Td, btn, btnGhost, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/dates";

export default async function Loyalty({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; await requireUser("manager");
  const tiers = await loadTiers();
  const top = await db.prepare(`SELECT g.id,g.name,g.loyalty_points,(SELECT COUNT(*) FROM bookings b WHERE b.guest_id=g.id AND b.status='completed') stays FROM guests g WHERE erased_at IS NULL ORDER BY loyalty_points DESC LIMIT 25`).all() as { id: number; name: string; loyalty_points: number; stays: number }[];
  const ledger = await db.prepare("SELECT l.points,l.reason,l.created_at,g.name FROM loyalty_ledger l JOIN guests g ON g.id=l.guest_id ORDER BY l.id DESC LIMIT 15").all() as { points: number; reason: string; created_at: string; name: string }[];
  const liability = (await db.prepare("SELECT COALESCE(SUM(loyalty_points),0) s FROM guests").get() as { s: number }).s * Number(await getSetting("loyalty_point_value"));
  const guests = await db.prepare("SELECT id,name FROM guests WHERE erased_at IS NULL ORDER BY name LIMIT 500").all() as { id: number; name: string }[];
  return (
    <>
      <PageHeader title="Loyalty & points" sub={`Outstanding points are worth about ₹${liability.toLocaleString("en-IN")} if all redeemed.`} />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Rules">
          <form action={saveLoyaltySettingsAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Points earned per ₹100 spent"><input name="loyalty_points_per_100" type="number" step="0.5" defaultValue={await getSetting("loyalty_points_per_100")} className={inputCls} /></Field>
            <Field label="₹ value of 1 point"><input name="loyalty_point_value" type="number" step="0.1" defaultValue={await getSetting("loyalty_point_value")} className={inputCls} /></Field>
            <Field label="Welcome bonus (points)"><input name="loyalty_welcome_bonus" type="number" defaultValue={await getSetting("loyalty_welcome_bonus")} className={inputCls} /></Field>
            <Field label="Bonus for leaving a review"><input name="loyalty_review_bonus" type="number" defaultValue={await getSetting("loyalty_review_bonus")} className={inputCls} /></Field>
            <Field label="Tier 2 name / stays"><div className="flex gap-1"><input name="t1n" defaultValue={tiers[1]?.name} className={inputCls} /><input name="t1m" type="number" defaultValue={tiers[1]?.minStays} className={inputCls + " w-20"} /></div></Field>
            <Field label="Tier 3 name / stays"><div className="flex gap-1"><input name="t2n" defaultValue={tiers[2]?.name} className={inputCls} /><input name="t2m" type="number" defaultValue={tiers[2]?.minStays} className={inputCls + " w-20"} /></div></Field>
            <button className={btn}>Save rules</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Points are awarded at check-out. Guests redeem them when a booking is created. Owner only.</p>
        </Card>
        <Card title="Give or deduct points (reason is logged)">
          <form action={adjustPointsAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Guest"><select name="guest_id" className={inputCls}>{guests.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
            <Field label="Points (negative to deduct)"><input name="points" type="number" required className={inputCls} /></Field>
            <div className="sm:col-span-2"><Field label="Reason"><input name="reason" required className={inputCls} placeholder="Stayed at our sister homestay / apology for delay" /></Field></div>
            <button className={btnGhost}>Apply</button>
          </form>
          <h3 className="mt-4 text-xs font-semibold uppercase text-slate-500">Recent activity</h3>
          <ul className="mt-1 space-y-1 text-xs text-slate-600">{ledger.map((l, i) => <li key={i}>{fmtDate(l.created_at)} · {l.name} · <b className={l.points < 0 ? "text-rose-700" : "text-emerald-700"}>{l.points > 0 ? "+" : ""}{l.points}</b> · {l.reason}</li>)}</ul>
        </Card>
      </div>
      <Card title="Top members" className="mt-4">
        <Table head={["Guest", "Tier", "Stays", "Points"]}>{top.map((g) => <tr key={g.id}><Td>{g.name}</Td><Td>{tierName(tiers, g.stays)}</Td><Td>{g.stays}</Td><Td>{g.loyalty_points}</Td></tr>)}</Table>
      </Card>
    </>
  );
}
