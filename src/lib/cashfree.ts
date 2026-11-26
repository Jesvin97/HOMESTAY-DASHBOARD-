/**
 * Cashfree Payments refunds. The WEBSITE creates the payment order and checks payments;
 * the dashboard sends refunds, so it only needs the refund calls.
 * Env: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV ("sandbox" default, or "production").
 * CASHFREE_API_BASE overrides the address (used by tests with a stand-in server).
 */
const API_VERSION = "2023-08-01";

export const cashfreeConfigured = () => Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
const base = () => process.env.CASHFREE_API_BASE || (process.env.CASHFREE_ENV === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg");

async function cf<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(base() + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": API_VERSION,
      "x-client-id": process.env.CASHFREE_APP_ID!,
      "x-client-secret": process.env.CASHFREE_SECRET_KEY!,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Cashfree ${path} failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return (await res.json()) as T;
}

export type CashfreeRefund = { refund_id?: string; cf_refund_id?: number | string; refund_status?: string; refund_amount?: number };

export const createRefund = (p: { orderId: string; refundId: string; amountRupees: number; note: string }) =>
  cf<CashfreeRefund>(`/orders/${encodeURIComponent(p.orderId)}/refunds`, {
    refund_amount: p.amountRupees, refund_id: p.refundId, refund_note: p.note.slice(0, 100), refund_speed: "STANDARD",
  });

export const getRefund = (orderId: string, refundId: string) => cf<CashfreeRefund>(`/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`);
