import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isRoomFree, quote } from "@/lib/pricing";
import { isValidDate, nightsBetween } from "@/lib/dates";
import { checkApiKey } from "@/lib/publicApi";

/** GET /api/public/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&guests=2&coupon=CODE  (header x-api-key) */
export async function GET(req: Request) {
  if (!checkApiKey(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const ci = u.searchParams.get("checkIn") || "", co = u.searchParams.get("checkOut") || "";
  const guests = Number(u.searchParams.get("guests") || 1);
  if (!isValidDate(ci) || !isValidDate(co) || nightsBetween(ci, co) < 1 || nightsBetween(ci, co) > 60) return NextResponse.json({ error: "invalid dates" }, { status: 400 });
  const rooms = await db.prepare("SELECT id,name,type,capacity,description FROM rooms WHERE active=1 AND capacity>=?").all(guests) as { id: number; name: string; type: string; capacity: number; description: string }[];
  const free = (await Promise.all(rooms.map(async (r) => ((await isRoomFree(r.id, ci, co)) ? r : null)))).filter((r) => r !== null);
  const out = await Promise.all(free.map(async (r) => {
    const q = await quote({ roomId: r.id, checkIn: ci, checkOut: co, couponCode: u.searchParams.get("coupon") });
    const photos = await db.prepare("SELECT url,caption FROM photos WHERE room_id=? ORDER BY sort").all(r.id);
    return { ...r, nights: q.nights, roomAmount: q.roomAmount, discount: q.discount, gst: q.gst, total: q.total, couponError: q.couponError ?? null, photos };
  }));
  return NextResponse.json({ rooms: out });
}
