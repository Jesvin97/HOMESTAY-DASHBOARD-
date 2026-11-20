import Link from "next/link";
import { db } from "@/lib/db";
import { loadTiers, tierName } from "@/lib/bookings";
import { Card, PageHeader, Table, Td, btnGhost, inputCls } from "@/components/ui";
import { inr } from "@/lib/dates";

export default async function Guests({ searchParams }: { searchParams: Promise<{ q?: string; msg?: string }> }) {
  const sp = await searchParams;
  const l = `%${sp.q || ""}%`;
  const tiers = await loadTiers();
  const rows = await db.prepare(
    `SELECT g.id,g.name,g.phone,g.email,g.aadhaar_last4,g.consent_marketing,g.loyalty_points,
      (SELECT COUNT(*) FROM bookings b WHERE b.guest_id=g.id AND b.status='completed') stays,
      (SELECT COALESCE(SUM(total),0) FROM bookings b WHERE b.guest_id=g.id AND b.status IN ('completed','checked_in','confirmed')) spent
     FROM guests g WHERE g.erased_at IS NULL AND (g.name LIKE ? OR g.phone LIKE ? OR g.email LIKE ?) ORDER BY g.id DESC LIMIT 300`).all(l, l, l) as
    { id: number; name: string; phone: string | null; email: string | null; aadhaar_last4: string | null; consent_marketing: number; loyalty_points: number; stays: number; spent: number }[];
  return (
    <>
      <PageHeader title="Guests" sub="Name, phone and email for every guest. Aadhaar is optional and shown masked." />
      <form className="mb-3 flex gap-2"><input name="q" defaultValue={sp.q} placeholder="Search name / phone / email" className={inputCls + " max-w-sm"} /><button className={btnGhost}>Search</button></form>
      <Card>
        <Table head={["Name", "Phone", "Email", "Aadhaar", "Stays", "Spent", "Tier", "Points", "Marketing"]} empty={rows.length ? undefined : "No guests."}>
          {rows.map((g) => (
            <tr key={g.id} className="hover:bg-slate-50">
              <Td><Link className="font-medium text-brand-700 hover:underline" href={`/guests/${g.id}`}>{g.name}</Link></Td><Td>{g.phone}</Td><Td>{g.email}</Td>
              <Td>{g.aadhaar_last4 ? `•••• •••• ${g.aadhaar_last4}` : "—"}</Td><Td>{g.stays}</Td><Td>{inr(g.spent)}</Td><Td>{tierName(tiers, g.stays)}</Td><Td>{g.loyalty_points}</Td><Td>{g.consent_marketing ? "✓ opted in" : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
