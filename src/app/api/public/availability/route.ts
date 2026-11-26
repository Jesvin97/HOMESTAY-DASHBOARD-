import { signedRoute, str, int, planOf } from "@/lib/publicRoute";
import { availability } from "@/lib/onlineBookings";
import { expireUnpaidHolds } from "@/lib/bookings";

/**
 * GET /api/public/availability?checkIn=&checkOut=&adults=&children=&plan=bb|meals&services=pickup,dinner&coupon=CODE
 * Every room, whether it is free, and its price. Signed request (see signedApi.ts).
 */
export async function GET(req: Request) {
  return signedRoute(req, async ({ url }) => {
    await expireUnpaidHolds();
    const q = url.searchParams;
    return availability(
      { checkIn: str(q.get("checkIn")), checkOut: str(q.get("checkOut")), adults: int(q.get("adults"), 2), children: int(q.get("children"), 0), plan: planOf(q.get("plan")) },
      str(q.get("services"), 200).split(",").filter(Boolean), str(q.get("coupon"), 40) || undefined,
    );
  });
}
