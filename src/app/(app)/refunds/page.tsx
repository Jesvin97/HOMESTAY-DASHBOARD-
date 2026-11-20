import { db } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { approveRefundAction, rejectRefundAction, setRefundUpiAction } from "@/app/actions";
import { Card, Flash, PageHeader, Table, Td, Badge, btn, btnGhost, inputCls } from "@/components/ui";
import { inr, fmtDate } from "@/lib/dates";
import Link from "next/link";

type R = { id: number; booking_id: number; code: string; gname: string; amount: number; upi_id: string | null; status: string; policy_note: string; provider_ref: string | null; failure_reason: string | null; created_at: string; proposer: string | null };

export default async function Refunds({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; const u = await requireUser();
  const rows = await db.prepare(`SELECT r.*, b.code, g.name gname, (SELECT name FROM users WHERE id=r.proposed_by) proposer FROM refunds r JOIN bookings b ON b.id=r.booking_id JOIN guests g ON g.id=b.guest_id ORDER BY (r.status IN ('proposed','failed')) DESC, r.id DESC LIMIT 200`).all() as R[];
  const live = !!process.env.RAZORPAYX_KEY_ID;
  return (
    <>
      <PageHeader title="Refunds via UPI" sub="Cancellation proposes a refund by policy. Nothing is paid until a manager/owner approves." />
      <Flash msg={sp.msg} err={sp.err} />
      {!live && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>Simulation mode:</b> no payout provider is configured, so approving a refund records it as paid but <b>moves no money</b>. Set RAZORPAYX_* in your environment to go live.</p>}
      <Card>
        <Table head={["Booking", "Guest", "Amount", "Why", "UPI ID", "Status", "Action"]} empty={rows.length ? undefined : "No refunds yet."}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td><Link className="text-brand-700 hover:underline" href={`/bookings/${r.booking_id}`}>{r.code}</Link><div className="text-xs text-slate-500">{fmtDate(r.created_at)}</div></Td>
              <Td>{r.gname}</Td><Td className="font-medium">{inr(r.amount)}</Td><Td className="max-w-[16rem] text-xs text-slate-600">{r.policy_note}{r.proposer && <div>proposed by {r.proposer}</div>}</Td>
              <Td>{["proposed", "failed"].includes(r.status) ? (
                <form action={setRefundUpiAction} className="flex gap-1"><input type="hidden" name="id" value={r.id} /><input name="upi_id" defaultValue={r.upi_id ?? ""} placeholder="name@bank" className={inputCls + " w-40"} /><button className={btnGhost}>Save</button></form>) : r.upi_id}</Td>
              <Td><Badge v={r.status} />{r.failure_reason && <div className="text-xs text-rose-700">{r.failure_reason}</div>}{r.provider_ref && <div className="text-xs text-slate-500">{r.provider_ref}</div>}</Td>
              <Td>{["proposed", "failed"].includes(r.status) && (can(u, "manager") ? (
                <div className="space-y-1">
                  <form action={approveRefundAction} className="flex gap-1"><input type="hidden" name="id" value={r.id} /><input name="confirm" placeholder={`type ${r.amount}`} className={inputCls + " w-24"} required /><button className={btn}>Approve &amp; pay</button></form>
                  <form action={rejectRefundAction}><input type="hidden" name="id" value={r.id} /><button className="text-xs text-rose-600 hover:underline">Reject</button></form>
                </div>) : <span className="text-xs text-slate-500">Manager must approve</span>)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
