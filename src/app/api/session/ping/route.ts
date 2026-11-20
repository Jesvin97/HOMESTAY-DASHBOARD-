import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

export async function POST() {
  const u = await getUser(true);
  return NextResponse.json({ ok: !!u }, { status: u ? 200 : 401 });
}
