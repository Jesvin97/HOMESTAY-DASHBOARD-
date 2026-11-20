"use client";
import { useActionState } from "react";
import { revealAadhaarAction } from "@/app/actions";
import { btnGhost } from "@/components/ui";

export default function RevealAadhaar({ guestId }: { guestId: number }) {
  const [s, act, pending] = useActionState(revealAadhaarAction, {} as { value?: string; error?: string });
  return (
    <form action={act} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={guestId} />
      <button className={btnGhost} disabled={pending}>Reveal once (logged)</button>
      {s.value && <code className="rounded bg-amber-50 px-2 py-1 text-sm">{s.value}</code>}
      {s.error && <span role="alert" className="text-sm text-rose-700">{s.error}</span>}
    </form>
  );
}
