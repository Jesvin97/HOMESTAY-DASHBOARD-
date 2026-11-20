import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setConsent } from "@/lib/bookings";

/** RFC 8058 one-click unsubscribe: mail clients POST here (List-Unsubscribe-Post header). No login. */
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = await db.prepare("SELECT id FROM guests WHERE unsub_token=? AND erased_at IS NULL").get<{ id: number }>(token);
  if (g) await setConsent(g.id, "marketing_email", false, "one_click_unsubscribe");
  return NextResponse.json({ ok: true });
}
