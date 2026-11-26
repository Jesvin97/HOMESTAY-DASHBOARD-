import { signedRoute, CODE_RE } from "@/lib/publicRoute";
import { releaseHold } from "@/lib/onlineBookings";

/** POST /api/public/holds/{code}/release -> gives the dates back (the payment could not be started). */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return signedRoute(req, async () => (CODE_RE.test(code) ? releaseHold(code) : { ok: false as const, status: 400, error: "Invalid booking code." }));
}
