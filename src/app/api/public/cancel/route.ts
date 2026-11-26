import { signedRoute, str, CODE_RE } from "@/lib/publicRoute";
import { cancelByGuest } from "@/lib/onlineBookings";

/** POST /api/public/cancel {code, phone} -> cancels the booking and refunds what the policy allows today (once only). */
export async function POST(req: Request) {
  return signedRoute(req, async ({ body }) => {
    const code = str(body.code, 30).toUpperCase();
    return CODE_RE.test(code) ? cancelByGuest(code, str(body.phone, 20).replace(/\D/g, "")) : { ok: false as const, status: 404, error: "We couldn't find a booking with that ID and mobile number." };
  });
}
