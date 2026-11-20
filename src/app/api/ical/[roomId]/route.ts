import { NextResponse } from "next/server";
import crypto from "crypto";
import { roomIcs } from "@/lib/ical";

export async function GET(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const want = process.env.ICAL_TOKEN;
  const got = new URL(req.url).searchParams.get("token") || "";
  const ok = want ? got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want)) : process.env.NODE_ENV !== "production";
  if (!ok) return new NextResponse("Forbidden", { status: 403 });
  const { roomId } = await params;
  return new NextResponse(await roomIcs(Number(roomId)), { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
}
