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
  const rooms = db.prepare("SELECT id,name,type,capacity,description FROM rooms WHERE active=1 AND capacity>=?").all(guests) as { id: number; name: string; type: string; capacity: number; description: string }[];
  return NextResponse.json({
    rooms: rooms.filter((r) => isRoomFree(r.id, ci, co)).map((r) => {
      const q = quote({ roomId: r.id, checkIn: ci, checkOut: co, couponCode: u.searchParams.get("coupon") });
      return { ...r, nights: q.nights, roomAmount: q.roomAmount, discount: q.discount, gst: q.gst, total: q.total, couponError: q.couponError ?? null, photos: db.prepare("SELECT url,caption FROM photos WHERE room_id=? ORDER BY sort").all(r.id) };
    }),
  });
}
