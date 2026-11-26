import { signedRoute, str } from "@/lib/publicRoute";
import { createLead } from "@/lib/onlineBookings";

/** POST /api/public/leads {name, phone, note, consent, noticeVersion} -> a "request a callback" from the website. */
export async function POST(req: Request) {
  return signedRoute(req, async ({ body }) => createLead({ name: str(body.name, 100), phone: str(body.phone, 20).replace(/\D/g, ""), note: str(body.note, 300), consent: body.consent === true, noticeVersion: str(body.noticeVersion, 40) }));
}
