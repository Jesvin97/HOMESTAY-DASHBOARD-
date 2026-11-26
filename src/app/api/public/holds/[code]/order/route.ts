import { signedRoute, str, CODE_RE } from "@/lib/publicRoute";
import { attachProviderOrder } from "@/lib/onlineBookings";

/** POST /api/public/holds/{code}/order  {orderId} -> remembers the Cashfree order created for this hold. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return signedRoute(req, async ({ body }) => (CODE_RE.test(code) ? attachProviderOrder(code, str(body.orderId, 60)) : { ok: false as const, status: 400, error: "Invalid booking code." }));
}
