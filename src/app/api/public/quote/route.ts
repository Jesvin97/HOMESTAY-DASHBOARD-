import { signedRoute, str, int, planOf, strList } from "@/lib/publicRoute";
import { priceQuote } from "@/lib/onlineBookings";

/** POST /api/public/quote  {roomSlug, plan, checkIn, checkOut, adults, children, services[], coupon} -> the price, worked out by the dashboard. */
export async function POST(req: Request) {
  return signedRoute(req, async ({ body }) =>
    priceQuote(str(body.roomSlug, 60), { checkIn: str(body.checkIn), checkOut: str(body.checkOut), adults: int(body.adults, 2), children: int(body.children, 0), plan: planOf(body.plan) }, strList(body.services), str(body.coupon, 40) || undefined));
}
