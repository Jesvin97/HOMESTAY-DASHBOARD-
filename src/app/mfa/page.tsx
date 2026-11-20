import { redirect } from "next/navigation";
import { getUser, getPendingUser } from "@/lib/auth";
import { verifyMfaAction, cancelMfaAction } from "./actions";
import { inputCls, btn } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  if (await getUser(false)) redirect("/");
  const u = await getPendingUser();
  if (!u) redirect("/login");
  if (!u.totp_enabled) redirect("/mfa/setup");
  const sp = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Two-step verification</h1>
        <p className="text-sm text-slate-600">Open your authenticator app and enter the 6-digit code for <b>{u.email}</b>.</p>
        {sp.err && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{sp.err}</p>}
        <form action={verifyMfaAction} className="space-y-3">
          <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={11} required autoFocus placeholder="123456" className={inputCls + " text-center text-lg tracking-widest"} aria-label="Authentication code" />
          <button className={btn + " w-full"}>Verify</button>
        </form>
        <p className="text-xs text-slate-500">Lost your phone? Enter one of your backup codes instead (like <code>ab12c-d34ef</code>).</p>
        <form action={cancelMfaAction}><button className="text-xs text-slate-500 underline">Use a different account</button></form>
      </div>
    </div>
  );
}
