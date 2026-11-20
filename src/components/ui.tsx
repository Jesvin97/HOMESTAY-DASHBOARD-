import Link from "next/link";
import type { ReactNode } from "react";

export const Card = ({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
    {(title || action) && (
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Stat = ({ label, value, sub, tone = "default", href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "warn" | "good"; href?: string }) => {
  const c = tone === "warn" ? "text-amber-700" : tone === "good" ? "text-brand-700" : "text-slate-900";
  const inner = (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${c}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
};

const badgeTones: Record<string, string> = {
  confirmed: "bg-blue-50 text-blue-700", pending: "bg-amber-50 text-amber-700", checked_in: "bg-indigo-50 text-indigo-700",
  completed: "bg-emerald-50 text-emerald-700", cancelled: "bg-rose-50 text-rose-700", no_show: "bg-slate-100 text-slate-600",
  sent: "bg-emerald-50 text-emerald-700", not_sent: "bg-amber-50 text-amber-700", failed: "bg-rose-50 text-rose-700", dry_run: "bg-slate-100 text-slate-600",
  proposed: "bg-amber-50 text-amber-700", approved: "bg-blue-50 text-blue-700", paid: "bg-emerald-50 text-emerald-700", rejected: "bg-slate-100 text-slate-600",
  open: "bg-rose-50 text-rose-700", in_progress: "bg-amber-50 text-amber-700", resolved: "bg-emerald-50 text-emerald-700",
  high: "bg-rose-50 text-rose-700", medium: "bg-amber-50 text-amber-700", low: "bg-slate-100 text-slate-600",
  draft: "bg-slate-100 text-slate-600", queued: "bg-slate-100 text-slate-600", requested: "bg-blue-50 text-blue-700", received: "bg-emerald-50 text-emerald-700",
};
export const Badge = ({ v }: { v: string }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[v] ?? "bg-slate-100 text-slate-700"}`}>{v.replace(/_/g, " ")}</span>
);

export const PageHeader = ({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div><h1 className="text-xl font-semibold text-slate-900">{title}</h1>{sub && <p className="text-sm text-slate-500">{sub}</p>}</div>
    {action}
  </div>
);

export const Flash = ({ msg, err }: { msg?: string; err?: string }) =>
  err ? <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
  : msg ? <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div> : null;

export const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
export const btn = "inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50";
export const btnGhost = "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";
export const btnDanger = "inline-flex items-center justify-center rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700";

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}</label>
);

export const Table = ({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">{head.map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
    {empty && <p className="py-6 text-center text-sm text-slate-500">{empty}</p>}
  </div>
);
export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => <td className={`px-2 py-2 align-top ${className}`}>{children}</td>;
