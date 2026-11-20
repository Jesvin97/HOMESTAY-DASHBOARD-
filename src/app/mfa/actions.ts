"use server";
import { redirect } from "next/navigation";
import { verifyMfaLogin, confirmMfaEnrollment, regenerateBackupCodes, requireUser, logout, getUser } from "@/lib/auth";

export async function verifyMfaAction(fd: FormData) {
  const r = await verifyMfaLogin(String(fd.get("code") || ""));
  if (r.error) redirect("/mfa?err=" + encodeURIComponent(r.error));
  redirect(r.backupLeft != null ? `/account?msg=${encodeURIComponent(`Backup code used — ${r.backupLeft} left. Generate new ones soon.`)}` : "/");
}

export type SetupState = { error?: string; codes?: string[] };
export async function confirmEnrollAction(_prev: SetupState, fd: FormData): Promise<SetupState> {
  const r = await confirmMfaEnrollment(String(fd.get("code") || ""));
  return r.ok ? { codes: r.backupCodes } : { error: r.error };
}
export async function regenCodesAction(_prev: SetupState, fd: FormData): Promise<SetupState> {
  const u = await requireUser();
  const r = await regenerateBackupCodes(u, String(fd.get("code") || ""));
  return r.codes ? { codes: r.codes } : { error: r.error };
}
export async function cancelMfaAction() {
  await logout();
  redirect("/login");
}
export async function isSignedIn() { return !!(await getUser(false)); }
