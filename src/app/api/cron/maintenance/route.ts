import { NextResponse } from "next/server";
import crypto from "crypto";
import { expireUnpaidHolds } from "@/lib/bookings";
import { runRetention } from "@/lib/privacy";

/** Call hourly from Cloudflare Cron Trigger / any scheduler: GET with header x-cron-secret. Releases unpaid holds; purges expired Aadhaar. */
export async function GET(req: Request) {
  const want = process.env.CRON_SECRET, got = req.headers.get("x-cron-secret") || "";
  if (!want || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ released: await expireUnpaidHolds(), retention: await runRetention() });
}
