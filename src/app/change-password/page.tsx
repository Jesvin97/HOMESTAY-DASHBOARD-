import { redirect } from "next/navigation";
import { requireUser, passwordProblem, hashPassword, verifyPassword, audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { inputCls, btn } from "@/components/ui";

async function change(fd: FormData) {
  "use server";
  const u = await requireUser();
  const cur = String(fd.get("current")), next = String(fd.get("next"));
  const row = await db.prepare("SELECT password_hash FROM users WHERE id=?").get(u.id) as { password_hash: string };
  if (!(await verifyPassword(cur, row.password_hash))) redirect("/change-password?err=" + encodeURIComponent("Current password is wrong."));
  const p = passwordProblem(next);
  if (p) redirect("/change-password?err=" + encodeURIComponent(p));
  await db.prepare("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?").run(await hashPassword(next), u.id);
  // revoke every other session after a password change
  await db.prepare("UPDATE sessions SET revoked=1 WHERE user_id=?").run(u.id);
  await audit(u, "password_changed", "user", u.id);
  redirect("/login");
}

export default async function Page({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form action={change} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Set a new password</h1>
        {sp.err && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{sp.err}</p>}
        <input name="current" type="password" placeholder="Current password" required className={inputCls} autoComplete="current-password" />
        <input name="next" type="password" placeholder="New password (12+ chars, mixed case, digit)" required className={inputCls} autoComplete="new-password" />
        <button className={btn + " w-full"}>Change password</button>
      </form>
    </div>
  );
}
