import { redirect } from "next/navigation";
import { requireUser, idleTimeoutMs } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import IdleTimer from "@/components/IdleTimer";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.must_change_password) redirect("/change-password");
  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <main className="min-w-0 flex-1 p-6">{children}</main>
      <IdleTimer idleMs={idleTimeoutMs} />
    </div>
  );
}
