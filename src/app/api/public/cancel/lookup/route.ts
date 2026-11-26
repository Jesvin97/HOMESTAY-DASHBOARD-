import { signedRoute, str, CODE_RE } from "@/lib/publicRoute";
import { lookupForGuest } from "@/lib/onlineBookings";

/** POST /api/public/cancel/lookup {code, phone} -> the booking and what a cancellation today would refund. */
export async function POST(req: Request) {
  return signedRoute(req, async ({ body }) => {
    const code = str(body.code, 30).toUpperCase();
    return CODE_RE.test(code) ? lookupForGuest(code, str(body.phone, 20).replace(/\D/g, "")) : { ok: false as const, status: 404, error: "We couldn't find a booking with that ID and mobile number." };
  });
}
