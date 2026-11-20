import Link from "next/link";
import { overview, monthlySeries, bySource, kpis } from "@/lib/stats";
import { Card, Stat, PageHeader, Flash, Table, Td, Badge } from "@/components/ui";
import { RevenueChart, SourceChart } from "@/components/charts";
import { inr, fmtDate } from "@/lib/dates";

export default async function Overview({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const sp = await searchParams;
  const [o, k, series, src] = await Promise.all([overview(), kpis(), monthlySeries(12), bySource()]);
  const delta = o.prevRevenue ? Math.round(((o.monthRevenue - o.prevRevenue) / o.prevRevenue) * 100) : null;
  const actions = [
    o.pendingRefunds && { href: "/refunds", t: `${o.pendingRefunds} refund(s) awaiting your approval` },
    o.unsentConfirmations && { href: "/bookings?filter=unsent", t: `${o.unsentConfirmations} booking(s) where the confirmation email hasn't gone out` },
    o.openComplaints && { href: "/inbox", t: `${o.openComplaints} open complaint(s)` },
    o.dsrOverdue && { href: "/privacy", t: `${o.dsrOverdue} privacy request(s) OVERDUE` },
    o.testimonialsQueued && { href: "/testimonials", t: `${o.testimonialsQueued} guest(s) ready for a testimonial request` },
  ].filter(Boolean) as { href: string; t: string }[];
  return (
    <>
      <PageHeader title="Overview" sub="Everything that needs you today, at a glance." />
      {sp.denied && <Flash err="You don't have permission for that page." />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue this month" value={inr(o.monthRevenue)} sub={delta == null ? "ex-GST, by check-in month" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs last month`} tone="good" />
        <Stat label="Collected (all time)" value={inr(o.collectedAllTime)} sub={`Refunded ${inr(o.refundedAllTime)}`} />
        <Stat label="Balance still to collect" value={inr(o.outstanding)} sub="upcoming + in-house" tone={o.outstanding ? "warn" : "default"} />
        <Stat label="Occupancy next 30 days" value={o.occupancyNext30 + "%"} sub={`${o.upcomingCount} upcoming bookings`} />
        <Stat label="ADR (12 mo)" value={inr(k.adr)} sub="avg daily rate ex-GST" />
        <Stat label="RevPAR (12 mo)" value={inr(k.revpar)} sub={`${k.occupancy}% occupancy`} />
        <Stat label="Cancellation rate" value={k.cancelRate + "%"} sub={`Repeat guests ${k.repeatRate}%`} />
        <Stat label="Avg guest rating" value={k.avgRating ? k.avgRating.toFixed(1) + " / 5" : "—"} sub={`Avg stay ${k.avgStay.toFixed(1)} nights`} />
      </div>

      {actions.length > 0 && (
        <Card title="Needs your attention" className="mt-4">
          <ul className="space-y-1 text-sm">{actions.map((a) => <li key={a.t}><Link className="text-brand-700 hover:underline" href={a.href}>→ {a.t}</Link></li>)}</ul>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Revenue — last 12 months" className="lg:col-span-2"><RevenueChart data={series} /></Card>
        <Card title="Where bookings come from"><SourceChart data={src} /></Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Arrivals — next 7 days">
          <Table head={["Guest", "Room", "Check-in", "Balance"]} empty={o.arrivals.length ? undefined : "No arrivals."}>
            {o.arrivals.map((a) => <tr key={a.id}><Td><Link className="text-brand-700 hover:underline" href={`/bookings/${a.id}`}>{a.name}</Link></Td><Td>{a.room}</Td><Td>{fmtDate(a.check_in)}</Td><Td>{inr(a.total - a.paid)}</Td></tr>)}
          </Table>
        </Card>
        <Card title="Departures — next 3 days">
          <Table head={["Guest", "Room", "Check-out", ""]} empty={o.departures.length ? undefined : "No departures."}>
            {o.departures.map((a) => <tr key={a.id}><Td><Link className="text-brand-700 hover:underline" href={`/bookings/${a.id}`}>{a.name}</Link></Td><Td>{a.room}</Td><Td>{fmtDate(a.check_out)}</Td><Td><Badge v="confirmed" /></Td></tr>)}
          </Table>
        </Card>
      </div>
    </>
  );
}
