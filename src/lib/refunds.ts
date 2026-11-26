import { db } from "./db";
import { cashfreeConfigured, createRefund, getRefund } from "./cashfree";

type Row = { id: number; booking_id: number; amount: number; status: string; provider_ref: string | null; code: string };

/**
 * Sends one approved refund to Cashfree (back to the guest's original payment method).
 * Safe to run again: the refund id is fixed per refund, so Cashfree never refunds twice.
 *   success  -> "paid"      (provider_ref = Cashfree refund id)
 *   pending  -> "approved"  (still on its way; run again later to refresh)
 *   problem  -> "failed"    (reason saved; a manager can retry from /refunds)
 * Without Cashfree keys, a refund is only simulated outside production (so local testing works).
 */
export async function executeCashfreeRefund(refundId: number): Promise<{ status: "paid" | "approved" | "failed"; error?: string; simulated?: boolean }> {
  const r = await db.prepare("SELECT r.id,r.booking_id,r.amount,r.status,r.provider_ref,b.code FROM refunds r JOIN bookings b ON b.id=r.booking_id WHERE r.id=?").get<Row>(refundId);
  if (!r) return { status: "failed", error: "Refund not found." };
  if (r.status === "paid") return { status: "paid" };
  if (!["approved", "failed"].includes(r.status)) return { status: "failed", error: "Refund is not approved yet." };

  if (!cashfreeConfigured()) {
    if (process.env.NODE_ENV === "production") {
      await db.prepare("UPDATE refunds SET status='failed', failure_reason=? WHERE id=?").run("Cashfree is not configured", refundId);
      return { status: "failed", error: "Cashfree is not configured" };
    }
    await db.prepare("UPDATE refunds SET status='paid', provider_ref=?, failure_reason=NULL, method='cashfree' WHERE id=?").run("[SIMULATED] " + r.code, refundId);
    return { status: "paid", simulated: true };
  }

  const cfRefundId = `${r.code}-R${r.id}`;
  try {
    let res = await getRefund(r.code, cfRefundId).catch(() => null); // already sent before?
    if (!res?.refund_status) res = await createRefund({ orderId: r.code, refundId: cfRefundId, amountRupees: r.amount, note: `Cancellation ${r.code}` });
    const ref = String(res.cf_refund_id ?? cfRefundId);
    if (res.refund_status === "SUCCESS") {
      await db.prepare("UPDATE refunds SET status='paid', provider_ref=?, failure_reason=NULL, method='cashfree' WHERE id=?").run(ref, refundId);
      return { status: "paid" };
    }
    if (res.refund_status === "CANCELLED") {
      await db.prepare("UPDATE refunds SET status='failed', provider_ref=?, failure_reason='Cashfree cancelled the refund', method='cashfree' WHERE id=?").run(ref, refundId);
      return { status: "failed", error: "Cashfree cancelled the refund" };
    }
    await db.prepare("UPDATE refunds SET status='approved', provider_ref=?, failure_reason=NULL, method='cashfree' WHERE id=?").run(ref, refundId);
    return { status: "approved" };
  } catch (e) {
    const msg = (e as Error).message;
    await db.prepare("UPDATE refunds SET status='failed', failure_reason=?, method='cashfree' WHERE id=?").run(msg.slice(0, 300), refundId);
    return { status: "failed", error: msg };
  }
}
