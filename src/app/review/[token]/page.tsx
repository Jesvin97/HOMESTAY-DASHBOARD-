import { db, getSetting } from "@/lib/db";
import { addPoints } from "@/lib/bookings";

export const dynamic = "force-dynamic";

async function submit(fd: FormData) {
  "use server";
  const token = String(fd.get("token"));
  const t = await db.prepare("SELECT id,guest_id,status FROM testimonials WHERE token=?").get(token) as { id: number; guest_id: number; status: string } | undefined;
  if (!t || t.status === "received") return;
  const rating = Math.min(5, Math.max(1, Number(fd.get("rating")) || 5));
  await db.prepare("UPDATE testimonials SET status='received', rating=?, text=?, publish=? WHERE id=?").run(rating, String(fd.get("text") || "").slice(0, 1500), fd.get("publish") === "on" ? 1 : 0, t.id);
  const bonus = Number(await getSetting("loyalty_review_bonus") || 0);
  if (bonus) await addPoints(t.guest_id, bonus, "Review bonus", t.id);
}

export default async function Review({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await db.prepare("SELECT status FROM testimonials WHERE token=?").get(token) as { status: string } | undefined;
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border bg-white p-6">
      <h1 className="mb-1 text-lg font-semibold">How was your stay at {await getSetting("property_name")}?</h1>
      {!t ? <p>This link is not valid.</p> : t.status === "received" ? <p className="mt-3">Thank you! Your feedback has been received 🌿</p> : (
        <form action={submit} className="mt-4 space-y-3"><input type="hidden" name="token" value={token} />
          <label className="block text-sm">Rating<select name="rating" defaultValue="5" className="mt-1 w-full rounded border p-2">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}</select></label>
          <label className="block text-sm">Your words<textarea name="text" rows={4} className="mt-1 w-full rounded border p-2" /></label>
          <label className="flex gap-2 text-xs"><input type="checkbox" name="publish" /> You may show my comment (first name only) on the website.</label>
          <button className="rounded-lg bg-green-700 px-4 py-2 text-white">Send</button></form>)}
    </div>
  );
}
