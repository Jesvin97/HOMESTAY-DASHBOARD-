export const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export type PayoutResult = { ok: boolean; ref?: string; error?: string; simulated?: boolean };

/**
 * UPI payout adapter. Without RAZORPAYX_* credentials the payout is SIMULATED (no money moves).
 * With credentials it calls RazorpayX: contact -> fund account (vpa) -> payout (mode UPI).
 * Verify against RazorpayX docs and test in their sandbox before enabling in production.
 */
export async function payoutUpi(o: { upiId: string; amount: number; name: string; reference: string }): Promise<PayoutResult> {
  if (!UPI_RE.test(o.upiId)) return { ok: false, error: "Invalid UPI ID" };
  const { RAZORPAYX_KEY_ID: id, RAZORPAYX_KEY_SECRET: secret, RAZORPAYX_ACCOUNT_NUMBER: acct } = process.env;
  if (!id || !secret || !acct) return { ok: true, simulated: true, ref: "SIM-" + Date.now().toString(36).toUpperCase() };
  const auth = "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
  const call = async (path: string, body: unknown, idem?: string) => {
    const r = await fetch("https://api.razorpay.com/v1" + path, {
      method: "POST", headers: { Authorization: auth, "Content-Type": "application/json", ...(idem ? { "X-Payout-Idempotency": idem } : {}) }, body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.description || `HTTP ${r.status}`);
    return j;
  };
  try {
    const contact = await call("/contacts", { name: o.name, type: "customer", reference_id: o.reference });
    const fa = await call("/fund_accounts", { contact_id: contact.id, account_type: "vpa", vpa: { address: o.upiId } });
    const p = await call("/payouts", {
      account_number: acct, fund_account_id: fa.id, amount: o.amount * 100, currency: "INR", mode: "UPI", purpose: "refund",
      queue_if_low_balance: false, reference_id: o.reference, narration: "Booking refund",
    }, o.reference);
    return { ok: true, ref: p.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
