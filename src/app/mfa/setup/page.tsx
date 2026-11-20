import { redirect } from "next/navigation";
import { getUser, getPendingUser, beginMfaEnrollment } from "@/lib/auth";
import { qrDataUrl } from "@/lib/mfa";
import { EnrollForm } from "@/components/MfaForms";

export const dynamic = "force-dynamic";

export default async function MfaSetup() {
  const full = await getUser(false);
  const u = full ?? (await getPendingUser());
  if (!u) redirect("/login");
  if (u.totp_enabled) redirect(full ? "/account" : "/mfa");
  const { secret, uri } = await beginMfaEnrollment(u);
  const qr = await qrDataUrl(uri);
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Set up two-step verification</h1>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Install a free authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).</li>
          <li>Scan this QR code, or type the key in manually.</li>
          <li>Enter the 6-digit code it shows.</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code to add this account to your authenticator app" width={220} height={220} className="mx-auto rounded border" />
        <p className="break-all text-center font-mono text-xs text-slate-500">Manual key: {secret.match(/.{1,4}/g)?.join(" ")}</p>
        <EnrollForm />
      </div>
    </div>
  );
}
