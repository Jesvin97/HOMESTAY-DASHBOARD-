import { NextResponse } from "next/server";
import { getUser, audit } from "@/lib/auth";
import { exportGuestData } from "@/lib/privacy";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  audit(u, "guest_data_exported", "guest", id);
  return new NextResponse(JSON.stringify(exportGuestData(Number(id)), null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="guest-${Number(id)}-data.json"` },
  });
}
