import { signedRoute, str, int, planOf, strList } from "@/lib/publicRoute";
import { createHold } from "@/lib/onlineBookings";

/**
 * POST /api/public/holds  -> holds the dates for a guest who is about to pay and returns the booking code and the total.
 * 409 if the dates are taken. The unpaid hold lapses on its own after "web_hold_minutes".
 */
export async function POST(req: Request) {
  return signedRoute(req, async ({ body }) => {
    const g = (typeof body.guest === "object" && body.guest ? body.guest : {}) as Record<string, unknown>;
    return createHold({
      roomSlug: str(body.roomSlug, 60), checkIn: str(body.checkIn), checkOut: str(body.checkOut), adults: int(body.adults, 0), children: int(body.children, 0), plan: planOf(body.plan),
      services: strList(body.services), coupon: str(body.coupon, 40) || undefined, consent: body.consent === true, noticeVersion: str(body.noticeVersion, 40),
      guest: {
        name: str(g.name, 120), phone: str(g.phone, 20), email: str(g.email, 200) || undefined, bookingFor: str(g.bookingFor, 10), otherName: str(g.otherName, 120) || undefined,
        otherPhone: str(g.otherPhone, 20) || undefined, gstin: str(g.gstin, 20) || undefined, company: str(g.company, 120) || undefined, requests: strList(g.requests), message: str(g.message, 1000) || undefined,
      },
    });
  });
}
