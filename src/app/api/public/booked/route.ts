import { signedRoute, str } from "@/lib/publicRoute";
import { bookedRanges } from "@/lib/onlineBookings";
import { today } from "@/lib/dates";

/** GET /api/public/booked?room=slug -> date ranges already taken for that room (no guest details). */
export async function GET(req: Request) {
  return signedRoute(req, async ({ url }) => bookedRanges(str(url.searchParams.get("room"), 60), today()));
}
