import { NextResponse } from "next/server";
import { z } from "zod";
import { createBooking } from "@/lib/bookings";
import { checkApiKey } from "@/lib/publicApi";
import { audit } from "@/lib/auth";

const Body = z.object({
  roomId: z.number().int(), checkIn: z.string(), checkOut: z.string(), adults: z.number().int().min(1).max(20), children: z.number().int().min(0).max(20).default(0),
  name: z.string().min(1).max(120), phone: z.string().max(20).optional(), email: z.string().email().max(200).optional(),
  coupon: z.string().max(40).optional(), services: z.array(z.object({ id: z.number().int(), qty: z.number().int().min(1).max(20) })).max(20).optional(),
  marketingConsent: z.boolean().default(false), whatsappConsent: z.boolean().default(false), paidOnline: z.number().min(0).optional(), paymentRef: z.string().max(80).optional(),
});

/** Website checkout → dashboard. Creates a PENDING booking (owner confirms), so the owner stays in the loop. */
export async function POST(req: Request) {
  if (!checkApiKey(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid body", issues: p.error.issues }, { status: 400 });
  const d = p.data;
  const r = await createBooking({
    roomId: d.roomId, checkIn: d.checkIn, checkOut: d.checkOut, adults: d.adults, children: d.children, source: "website",
    guest: { name: d.name, phone: d.phone, email: d.email, consentMarketing: d.marketingConsent, consentWhatsapp: d.whatsappConsent },
    couponCode: d.coupon, services: d.services, paid: d.paidOnline, paymentMethod: d.paymentRef ? "online:" + d.paymentRef : undefined, status: "pending",
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  await audit(null, "website_booking", "booking", r.id, { code: r.code });
  return NextResponse.json({ id: r.id, code: r.code, status: "pending" }, { status: 201 });
}
