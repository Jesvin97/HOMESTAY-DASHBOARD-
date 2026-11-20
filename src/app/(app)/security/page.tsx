import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { addUserAction, deactivateUserAction, revokeSessionsAction } from "@/app/actions";
import { Card, Field, Flash, PageHeader, Table, Td, btn, btnGhost, inputCls } from "@/components/ui";

export default async function Security({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams; await requireUser("owner");
  const users = db.prepare("SELECT id,email,name,role,active,locked_until FROM users ORDER BY id").all() as { id: number; email: string; name: string; role: string; active: number; locked_until: string | null }[];
  const sessions = db.prepare("SELECT s.created_at,s.last_seen,s.ip,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.revoked=0 ORDER BY s.last_seen DESC LIMIT 20").all() as { created_at: string; last_seen: string; ip: string; email: string }[];
  const audit = db.prepare("SELECT ts,user_email,action,entity,entity_id,detail,ip FROM audit_log ORDER BY id DESC LIMIT 100").all() as { ts: string; user_email: string | null; action: string; entity: string | null; entity_id: string | null; detail: string | null; ip: string | null }[];
  return (
    <>
      <PageHeader title="Security & audit trail" sub={`Idle timeout ${process.env.IDLE_TIMEOUT_MIN || 15} min · absolute ${process.env.ABSOLUTE_TIMEOUT_HOURS || 8} h · lock after 5 failed sign-ins`} action={<form action={revokeSessionsAction}><button className={btnGhost}>Sign everyone else out</button></form>} />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Team">
          <Table head={["Name", "Role", ""]}>{users.map((u) => <tr key={u.id}><Td>{u.name}<div className="text-xs text-slate-500">{u.email}{!u.active && " · deactivated"}{u.locked_until && new Date(u.locked_until) > new Date() && " · locked"}</div></Td><Td className="capitalize">{u.role}</Td>
            <Td>{u.active ? <form action={deactivateUserAction}><input type="hidden" name="id" value={u.id} /><button className="text-xs text-rose-600 hover:underline">Deactivate</button></form> : null}</Td></tr>)}</Table>
          <form action={addUserAction} className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-2"><input name="name" placeholder="Name" required className={inputCls} /><input name="email" type="email" placeholder="Email" required className={inputCls} />
            <select name="role" className={inputCls}><option value="staff">Staff (bookings, guests)</option><option value="manager">Manager (+ prices, refunds, coupons)</option><option value="owner">Owner (everything)</option></select>
            <input name="password" type="password" placeholder="Temp password (12+ chars)" required className={inputCls} /><button className={btn}>Add user</button></form>
        </Card>
        <Card title="Active sessions"><ul className="space-y-1 text-xs text-slate-600">{sessions.map((s, i) => <li key={i}>{s.email} · {s.ip} · last active {s.last_seen.slice(0, 16).replace("T", " ")}</li>)}</ul></Card>
      </div>
      <Card title="Audit log (last 100 — prices, refunds, Aadhaar access, exports, logins)" className="mt-4">
        <Table head={["Time (UTC)", "User", "Action", "Target", "Detail"]}>{audit.map((a, i) => <tr key={i}><Td className="whitespace-nowrap text-xs">{a.ts}</Td><Td className="text-xs">{a.user_email ?? "—"}</Td><Td className="text-xs font-medium">{a.action}</Td><Td className="text-xs">{a.entity} {a.entity_id}</Td><Td className="max-w-xs truncate text-xs text-slate-500">{a.detail}</Td></tr>)}</Table>
      </Card>
    </>
  );
}
