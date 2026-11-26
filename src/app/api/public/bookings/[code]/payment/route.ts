import { signedRoute, str, CODE_RE } from "@/lib/publicRoute";
import { applyOnlinePayment } from "@/lib/onlineBookings";

/**
 * POST /api/public/bookings/{code}/payment  {orderId, paymentId, amount}
 * The website reports a payment it has verified with Cashfree. The booking is confirmed only if the amount equals the
 * total and the dates are still free; otherwise the guest is refunded in full. Safe to send more than once.
 */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return signedRoute(req, async ({ body }) =>
    CODE_RE.test(code)
      ? applyOnlinePayment(code, { orderId: str(body.orderId, 60), paymentId: str(body.paymentId, 80), amount: typeof body.amount === "number" ? body.amount : NaN })
      : { ok: false as const, status: 400, error: "Invalid booking code." });
}
