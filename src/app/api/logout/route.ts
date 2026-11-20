import { NextResponse } from "next/server";
import { logout, getUser, audit } from "@/lib/auth";

export async function POST(req: Request) {
  const u = await getUser(false);
  if (u) await audit(u, "logout", "user", u.id);
  await logout();
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
