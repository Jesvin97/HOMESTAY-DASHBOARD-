import { db } from "./db";
import { addDays, nightsBetween, today } from "./dates";

const one = <T,>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T;
const all = <T,>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];

export function overview() {
  const t = today();
  const m0 = t.slice(0, 7) + "-01";
  const activeRooms = one<{ c: number }>("SELECT COUNT(*) c FROM rooms WHERE active=1").c || 1;
  const earned = (from: string, to: string) =>
    one<{ s: number }>("SELECT COALESCE(SUM(paid),0) s FROM bookings WHERE status!='cancelled' AND date(created_at) BETWEEN ? AND ?", from, to).s;
  // revenue recognised by stay month (check-in), net of GST
  const rev = (from: string, to: string) =>
    one<{ s: number }>("SELECT COALESCE(SUM(total-gst),0) s FROM bookings WHERE status IN ('completed','checked_in','confirmed') AND check_in BETWEEN ? AND ?", from, to).s;
  const monthRevenue = rev(m0, t.slice(0, 7) + "-31");
  const prev0 = addDays(m0, -1).slice(0, 7);
  const prevRevenue = rev(prev0 + "-01", prev0 + "-31");

  const next30 = addDays(t, 30);
  const upcoming = all<{ check_in: string; check_out: string }>("SELECT check_in,check_out FROM bookings WHERE status IN ('confirmed','checked_in','pending') AND check_in<? AND check_out>?", next30, t);
  let nights30 = 0;
  for (const b of upcoming) nights30 += Math.max(0, nightsBetween(b.check_in < t ? t : b.check_in, b.check_out > next30 ? next30 : b.check_out));
  return {
    collectedAllTime: one<{ s: number }>("SELECT COALESCE(SUM(paid),0) s FROM bookings WHERE status!='cancelled'").s,
    refundedAllTime: one<{ s: number }>("SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE status='paid'").s,
    outstanding: one<{ s: number }>("SELECT COALESCE(SUM(total-paid),0) s FROM bookings WHERE status IN ('confirmed','checked_in','pending')").s,
    monthRevenue, prevRevenue, collectedThisMonth: earned(m0, t),
    occupancyNext30: Math.round((nights30 / (activeRooms * 30)) * 100),
    upcomingCount: one<{ c: number }>("SELECT COUNT(*) c FROM bookings WHERE status='confirmed' AND check_in>=?", t).c,
    pendingRefunds: one<{ c: number }>("SELECT COUNT(*) c FROM refunds WHERE status='proposed'").c,
    openComplaints: one<{ c: number }>("SELECT COUNT(*) c FROM complaints WHERE status!='resolved'").c,
    unsentConfirmations: one<{ c: number }>("SELECT COUNT(*) c FROM bookings WHERE status IN ('confirmed','pending') AND confirmation_status IN ('not_sent','failed')").c,
    dsrOpen: one<{ c: number }>("SELECT COUNT(*) c FROM dsr_requests WHERE status='open'").c,
    dsrOverdue: one<{ c: number }>("SELECT COUNT(*) c FROM dsr_requests WHERE status='open' AND due_date<?", t).c,
    testimonialsQueued: one<{ c: number }>("SELECT COUNT(*) c FROM testimonials WHERE status='queued'").c,
    arrivals: all<{ id: number; code: string; name: string; room: string; check_in: string; total: number; paid: number }>(
      `SELECT b.id,b.code,g.name,r.name room,b.check_in,b.total,b.paid FROM bookings b JOIN guests g ON g.id=b.guest_id JOIN rooms r ON r.id=b.room_id WHERE b.status='confirmed' AND b.check_in BETWEEN ? AND ? ORDER BY b.check_in LIMIT 8`, t, addDays(t, 7)),
    departures: all<{ id: number; code: string; name: string; room: string; check_out: string }>(
      `SELECT b.id,b.code,g.name,r.name room,b.check_out FROM bookings b JOIN guests g ON g.id=b.guest_id JOIN rooms r ON r.id=b.room_id WHERE b.status IN ('checked_in','confirmed') AND b.check_out BETWEEN ? AND ? ORDER BY b.check_out LIMIT 8`, t, addDays(t, 3)),
  };
}

export function monthlySeries(months = 12) {
  const t = today();
  const out: { month: string; revenue: number; bookings: number; cancelled: number; nights: number }[] = [];
  const d = new Date(t + "T00:00:00Z");
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - (months - 1));
  for (let i = 0; i < months; i++) {
    const m = d.toISOString().slice(0, 7);
    const r = one<{ rev: number; n: number; nights: number }>(
      "SELECT COALESCE(SUM(total-gst),0) rev, COUNT(*) n, COALESCE(SUM(julianday(check_out)-julianday(check_in)),0) nights FROM bookings WHERE status IN ('completed','checked_in','confirmed') AND substr(check_in,1,7)=?", m);
    const c = one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE status='cancelled' AND substr(check_in,1,7)=?", m).n;
    out.push({ month: m, revenue: r.rev, bookings: r.n, cancelled: c, nights: r.nights });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export const bySource = () =>
  all<{ source: string; revenue: number; bookings: number; commission: number }>(
    "SELECT source, SUM(total-gst) revenue, COUNT(*) bookings, SUM(commission) commission FROM bookings WHERE status IN ('completed','checked_in','confirmed') GROUP BY source ORDER BY revenue DESC");
export const byRoom = () =>
  all<{ room: string; revenue: number; nights: number }>(
    "SELECT r.name room, COALESCE(SUM(b.total-b.gst),0) revenue, COALESCE(SUM(julianday(b.check_out)-julianday(b.check_in)),0) nights FROM rooms r LEFT JOIN bookings b ON b.room_id=r.id AND b.status IN ('completed','checked_in','confirmed') GROUP BY r.id ORDER BY revenue DESC");
export const byCoupon = () =>
  all<{ code: string; uses: number; discount: number; revenue: number }>(
    "SELECT coupon_code code, COUNT(*) uses, SUM(discount) discount, SUM(total) revenue FROM bookings WHERE coupon_code IS NOT NULL AND status!='cancelled' GROUP BY coupon_code ORDER BY uses DESC");

export function kpis() {
  const r = one<{ rev: number; nights: number; n: number; canc: number; total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('completed','checked_in','confirmed') THEN total-gst END),0) rev,
            COALESCE(SUM(CASE WHEN status IN ('completed','checked_in','confirmed') THEN julianday(check_out)-julianday(check_in) END),0) nights,
            SUM(CASE WHEN status IN ('completed','checked_in','confirmed') THEN 1 ELSE 0 END) n,
            SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) canc, COUNT(*) total
     FROM bookings WHERE check_in>=date('now','-365 day')`);
  const rooms = one<{ c: number }>("SELECT COUNT(*) c FROM rooms WHERE active=1").c || 1;
  const repeat = one<{ r: number; t: number }>(
    "SELECT SUM(CASE WHEN c>1 THEN 1 ELSE 0 END) r, COUNT(*) t FROM (SELECT guest_id, COUNT(*) c FROM bookings WHERE status='completed' GROUP BY guest_id)");
  const avgRating = one<{ a: number | null }>("SELECT AVG(rating) a FROM testimonials WHERE rating IS NOT NULL").a;
  return {
    adr: r.nights ? r.rev / r.nights : 0,
    occupancy: Math.round((r.nights / (rooms * 365)) * 100),
    revpar: r.rev / (rooms * 365),
    avgStay: r.n ? r.nights / r.n : 0,
    cancelRate: r.total ? Math.round((r.canc / r.total) * 100) : 0,
    repeatRate: repeat.t ? Math.round(((repeat.r || 0) / repeat.t) * 100) : 0,
    avgRating,
  };
}
