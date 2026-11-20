"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: { group: string; items: { href: string; label: string }[] }[] = [
  { group: "Run the stay", items: [
    { href: "/", label: "Overview" }, { href: "/bookings", label: "Bookings" }, { href: "/calendar", label: "Availability" },
    { href: "/guests", label: "Guests" }, { href: "/refunds", label: "Refunds (UPI)" }, { href: "/inbox", label: "Inbox & complaints" } ] },
  { group: "Grow", items: [
    { href: "/reports", label: "Reports" }, { href: "/coupons", label: "Coupons" }, { href: "/loyalty", label: "Loyalty" },
    { href: "/marketing", label: "Email marketing" }, { href: "/testimonials", label: "Testimonials" } ] },
  { group: "Property", items: [
    { href: "/rooms", label: "Rooms & pricing" }, { href: "/services", label: "Services & providers" }, { href: "/channels", label: "Channels (OTA)" } ] },
  { group: "Trust & admin", items: [
    { href: "/privacy", label: "Privacy (DPDP/GDPR)" }, { href: "/security", label: "Security & audit" }, { href: "/settings", label: "Settings" } ] },
];

export default function Sidebar({ user }: { user: { name: string; role: string } }) {
  const p = usePathname();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="px-4 py-4 text-lg font-semibold text-brand-700">🌿 Homestay Desk</div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Main">
        {NAV.map((g) => (
          <div key={g.group} className="mb-3">
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</div>
            {g.items.map((i) => {
              const active = i.href === "/" ? p === "/" : p.startsWith(i.href);
              return <Link key={i.href} href={i.href} className={`block rounded-lg px-2 py-1.5 text-sm ${active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}>{i.label}</Link>;
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3 text-sm">
        <div className="font-medium text-slate-800">{user.name}</div>
        <div className="mb-2 text-xs capitalize text-slate-500">{user.role}</div>
        <form action="/api/logout" method="post"><button className="text-xs text-rose-600 hover:underline">Sign out</button></form>
      </div>
    </aside>
  );
}
