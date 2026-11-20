import { redirect } from "next/navigation";
import { getUser, login } from "@/lib/auth";
import { inputCls, btn } from "@/components/ui";

async function doLogin(fd: FormData) {
  "use server";
  const r = await login(String(fd.get("email") || ""), String(fd.get("password") || ""));
  if (r.error) redirect("/login?err=" + encodeURIComponent(r.error));
  redirect("/");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ err?: string; timeout?: string }> }) {
  if (await getUser(false)) redirect("/");
  const sp = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form action={doLogin} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-brand-700">🌿 Homestay Desk</h1>
        {sp.timeout && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">You were signed out due to inactivity.</p>}
        {sp.err && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{sp.err}</p>}
        <label className="block text-sm font-medium">Email<input name="email" type="email" autoComplete="username" required className={inputCls + " mt-1"} /></label>
        <label className="block text-sm font-medium">Password<input name="password" type="password" autoComplete="current-password" required className={inputCls + " mt-1"} /></label>
        <button className={btn + " w-full"}>Sign in</button>
        <p className="text-xs text-slate-500">Accounts lock for 15 minutes after 5 failed attempts. Sessions end after inactivity.</p>
      </form>
    </div>
  );
}
