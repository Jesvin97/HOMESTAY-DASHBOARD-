import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, Flash, PageHeader } from "@/components/ui";
import { RegenForm } from "@/components/MfaForms";

export default async function Account({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; const u = await requireUser();
  const row = await db.prepare("SELECT backup_codes FROM users WHERE id=?").get<{ backup_codes: string | null }>(u.id);
  const left = row?.backup_codes ? (JSON.parse(row.backup_codes) as string[]).length : 0;
  return (
    <>
      <PageHeader title="My account" sub={`${u.name} · ${u.email} · ${u.role}`} />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Two-step verification">
          <p className="text-sm">Status: <b className="text-emerald-700">{u.totp_enabled ? "ON (authenticator app)" : "OFF"}</b></p>
          <p className="mt-1 text-sm text-slate-600">Backup codes left: <b>{left}</b></p>
          <div className="mt-3"><RegenForm /></div>
          <p className="mt-3 text-xs text-slate-500">New phone? Ask the owner to reset your two-step verification, then sign in and scan a new QR code.</p>
        </Card>
        <Card title="Password"><Link href="/change-password" className="text-sm text-brand-700 underline">Change password</Link> (signs out all your other sessions).</Card>
      </div>
    </>
  );
}
