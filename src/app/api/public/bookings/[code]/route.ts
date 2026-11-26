import { signedRoute, CODE_RE } from "@/lib/publicRoute";
import { publicBooking } from "@/lib/onlineBookings";

/** GET /api/public/bookings/{code} -> the booking's public summary (first name and last 4 phone digits only). */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return signedRoute(req, async () => (CODE_RE.test(code) ? publicBooking(code) : { ok: false as const, status: 400, error: "Invalid booking code." }));
}
