"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = ["#2f7043", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444", "#14b8a6"];
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export function RevenueChart({ data }: { data: { month: string; revenue: number; bookings: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label="Monthly revenue bar chart">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? Math.round(v / 1000) + "k" : v)} />
          <Tooltip formatter={(v) => inr(Number(v))} />
          <Bar dataKey="revenue" name="Revenue (ex-GST)" fill="#2f7043" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export function BookingsChart({ data }: { data: { month: string; bookings: number; cancelled: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label="Bookings and cancellations per month">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip /><Legend />
          <Line dataKey="bookings" stroke="#3b82f6" strokeWidth={2} dot={false} />
          <Line dataKey="cancelled" stroke="#ef4444" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
export function SourceChart({ data }: { data: { source: string; revenue: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label="Revenue by booking source">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="revenue" nameKey="source" innerRadius={50} outerRadius={85} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => inr(Number(v))} /><Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
export function RoomChart({ data }: { data: { room: string; revenue: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label="Revenue by room">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 30 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => Math.round(v / 1000) + "k"} />
          <YAxis type="category" dataKey="room" tick={{ fontSize: 11 }} width={110} />
          <Tooltip formatter={(v) => inr(Number(v))} />
          <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
