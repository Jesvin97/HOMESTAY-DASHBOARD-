import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { saveProviderAction, saveServiceAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, Table, Td, btn, btnGhost, inputCls } from "@/components/ui";
import { inr } from "@/lib/dates";

export default async function Services({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; await requireUser("manager");
  const providers = db.prepare("SELECT * FROM providers ORDER BY name").all() as { id: number; name: string; category: string; phone: string | null; email: string | null; commission_pct: number; active: number }[];
  const services = db.prepare("SELECT s.*, p.name pname FROM services s LEFT JOIN providers p ON p.id=s.provider_id ORDER BY s.category,s.name").all() as { id: number; name: string; category: string; price: number; unit: string; included: number; provider_id: number | null; pname: string | null; description: string | null; active: number }[];
  return (
    <>
      <PageHeader title="Services & providers" sub="Tours, jeep rides, estate walks, dining — included in tariff or charged extra — and who delivers them." />
      <Flash msg={sp.msg} err={sp.err} />
      <Card title="Services & packages">
        <Table head={["Service", "Category", "Price", "Provider", ""]}>
          {services.map((s) => (
            <tr key={s.id}><td colSpan={5} className="px-2 py-2">
              <form action={saveServiceAction} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-8"><input type="hidden" name="id" value={s.id} />
                <input name="name" defaultValue={s.name} className={inputCls + " sm:col-span-2"} /><input name="category" defaultValue={s.category} className={inputCls} />
                <input name="price" type="number" defaultValue={s.price} className={inputCls} /><input name="unit" defaultValue={s.unit} className={inputCls} />
                <select name="provider_id" defaultValue={s.provider_id ?? ""} className={inputCls}><option value="">— in-house —</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <div className="text-xs"><label><input type="checkbox" name="included" defaultChecked={!!s.included} /> in tariff</label><br /><label><input type="checkbox" name="active" defaultChecked={!!s.active} /> active</label></div>
                <button className={btnGhost}>Save</button></form></td></tr>))}
        </Table>
        <form action={saveServiceAction} className="mt-4 grid grid-cols-2 items-end gap-2 border-t pt-4 sm:grid-cols-8">
          <input name="name" placeholder="New service (e.g. Tea estate walk)" required className={inputCls + " sm:col-span-2"} /><input name="category" placeholder="Activity" className={inputCls} />
          <input name="price" type="number" placeholder="₹" className={inputCls} /><input name="unit" placeholder="per person" className={inputCls} />
          <select name="provider_id" className={inputCls}><option value="">— in-house —</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <label className="text-xs"><input type="checkbox" name="included" /> in tariff</label><button className={btn}>Add</button></form>
      </Card>
      <Card title="Service providers" className="mt-4">
        <Table head={["Name", "Category", "Phone", "Email", "Commission %", ""]}>
          {providers.map((p) => (<tr key={p.id}><td colSpan={6} className="px-2 py-2"><form action={saveProviderAction} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-7"><input type="hidden" name="id" value={p.id} />
            <input name="name" defaultValue={p.name} className={inputCls} /><input name="category" defaultValue={p.category} className={inputCls} /><input name="phone" defaultValue={p.phone ?? ""} className={inputCls} /><input name="email" defaultValue={p.email ?? ""} className={inputCls} />
            <input name="commission_pct" type="number" step="0.5" defaultValue={p.commission_pct} className={inputCls} /><label className="text-xs"><input type="checkbox" name="active" defaultChecked={!!p.active} /> active</label><button className={btnGhost}>Save</button></form></td></tr>))}
        </Table>
        <form action={saveProviderAction} className="mt-4 grid grid-cols-2 items-end gap-2 border-t pt-4 sm:grid-cols-6">
          <input name="name" placeholder="Provider name" required className={inputCls} /><input name="category" placeholder="Jeep / Guide / Chef" className={inputCls} /><input name="phone" placeholder="Phone" className={inputCls} /><input name="email" placeholder="Email" className={inputCls} />
          <input name="commission_pct" type="number" step="0.5" placeholder="Commission %" className={inputCls} /><button className={btn}>Add provider</button></form>
      </Card>
    </>
  );
}
