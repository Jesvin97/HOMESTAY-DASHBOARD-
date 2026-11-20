"use client";
import { useActionState } from "react";
import { confirmEnrollAction, regenCodesAction, type SetupState } from "@/app/mfa/actions";
import { inputCls, btn } from "@/components/ui";

function Codes({ codes }: { codes: string[] }) {
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><b>Save these backup codes now.</b> Each works once if you lose your phone. They won't be shown again.</p>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-slate-50 p-3 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <button type="button" className="text-sm text-brand-700 underline" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copy all</button>
      <div><a href="/" className={btn}>I've saved them — continue</a></div>
    </div>
  );
}

export function EnrollForm() {
  const [s, act, pending] = useActionState<SetupState, FormData>(confirmEnrollAction, {});
  if (s.codes) return <Codes codes={s.codes} />;
  return (
    <form action={act} className="space-y-3">
      {s.error && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{s.error}</p>}
      <label className="block text-sm font-medium">6-digit code from the app
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus className={inputCls + " mt-1 text-center text-lg tracking-widest"} />
      </label>
      <button className={btn + " w-full"} disabled={pending}>{pending ? "Checking…" : "Turn on two-step verification"}</button>
    </form>
  );
}

export function RegenForm() {
  const [s, act, pending] = useActionState<SetupState, FormData>(regenCodesAction, {});
  if (s.codes) return <Codes codes={s.codes} />;
  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <label className="text-sm">Current app code<input name="code" inputMode="numeric" maxLength={7} required className={inputCls + " mt-1 w-32"} /></label>
      <button className={btn} disabled={pending}>New backup codes</button>
      {s.error && <p role="alert" className="w-full text-sm text-rose-700">{s.error}</p>}
    </form>
  );
}
