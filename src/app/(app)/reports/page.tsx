import { monthlySeries, bySource, byRoom, byCoupon, kpis } from "@/lib/stats";
import { Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { RevenueChart, BookingsChart, SourceChart, RoomChart } from "@/components/charts";
import { inr } from "@/lib/dates";

export default async function Reports() {
  const [m, src, rooms, cp, k] = await Promise.all([monthlySeries(12), bySource(), byRoom(), byCoupon(), kpis()]);
  return (
    <>
      <PageHeader title="Reports" sub="Trailing 12 months. Revenue excludes GST (it isn't your income)." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ADR" value={inr(k.adr)} sub="avg daily rate" /><Stat label="Occupancy" value={k.occupancy + "%"} /><Stat label="RevPAR" value={inr(k.revpar)} /><Stat label="Cancellations" value={k.cancelRate + "%"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Revenue by month"><RevenueChart data={m} /></Card>
        <Card title="Bookings vs cancellations"><BookingsChart data={m} /></Card>
        <Card title="Revenue by source"><SourceChart data={src} /></Card>
        <Card title="Revenue by room"><RoomChart data={rooms} /></Card>
      </div>
      <Card title="Coupon performance" className="mt-4">
        <Table head={["Code", "Bookings", "Discount given", "Booking value"]} empty={cp.length ? undefined : "No coupon used yet."}>{cp.map((c) => <tr key={c.code}><Td className="font-mono">{c.code}</Td><Td>{c.uses}</Td><Td>{inr(c.discount)}</Td><Td>{inr(c.revenue)}</Td></tr>)}</Table>
      </Card>
    </>
  );
}
