import { db } from "@/lib/db";
import { setConsent } from "@/lib/bookings";

export const dynamic = "force-dynamic";

async function doUnsub(fd: FormData) {
  "use server";
  const g = db.prepare("SELECT id FROM guests WHERE unsub_token=?").get(String(fd.get("token"))) as { id: number } | undefined;
  if (g) setConsent(g.id, "marketing_email", false, "unsubscribe_link");
}

export default async function Unsub({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = db.prepare("SELECT id,consent_marketing FROM guests WHERE unsub_token=?").get(token) as { id: number; consent_marketing: number } | undefined;
  return (
    <div className="mx-auto mt-24 max-w-md rounded-xl border bg-white p-6 text-center">
      {!g ? <p>This link is no longer valid.</p> : g.consent_marketing ? (
        <form action={doUnsub}><input type="hidden" name="token" value={token} /><h1 className="mb-3 text-lg font-semibold">Unsubscribe from our emails?</h1>
          <button className="rounded-lg bg-slate-800 px-4 py-2 text-white">Yes, unsubscribe me</button></form>
      ) : <p>You're unsubscribed. We won't send you marketing emails.</p>}
    </div>
  );
}
