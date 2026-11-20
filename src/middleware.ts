import { NextResponse, type NextRequest } from "next/server";

// Cheap gate: no session cookie -> login. Real validation (idle/absolute timeout, revocation) happens server-side in requireUser().
const PUBLIC = [/^\/login/, /^\/unsubscribe\//, /^\/api\/public\//, /^\/api\/ical\//, /^\/api\/logout/, /^\/review\//, /^\/_next\//, /^\/favicon/];
export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (PUBLIC.some((r) => r.test(p))) return NextResponse.next();
  if (!req.cookies.get("hs_session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
