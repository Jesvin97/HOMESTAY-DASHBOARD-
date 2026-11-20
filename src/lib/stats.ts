import { db } from "./db";
import { expireUnpaidHolds } from "./bookings";
import { addDays, nightsBetween, today } from "./dates";

type Prm = string | number;
const one = async <T,>(sql: string, ...p: Prm[]) => (await db.prepare(sql).get(...p)) as T;
const all = async <T,>(sql: string, ...p: Prm[]) => (await db.prepare(sql).all(...p)) as T[];
const num = async (sql: string, ...p: Prm[]) => Number(Object.values((await one<Record<string, number>>(sql, ...p)) ?? { x: 0 })[0] ?? 0);

export async function overview() {
  await expireUnpaidHolds();
  const t = today();
  const m0 = t.slice(0, 7) + "-01";
  const next30 = addDays(t, 30);
  const prev0 = addDays(m0, -1).slice(0, 7);
  const rev = (from: string, to: string) =>
    num("SELECT COALESCE(SUM(total-gst),0) FROM bookings WHERE status IN ('completed','checked_in','confirmed') AND check_in BETWEEN ? AND ?", from, to);
  const [activeRoomsRaw, monthRevenue, prevRevenue, collectedThisMonth, collectedAllTime, refundedAllTime, outstanding, upcoming, upcomingCount,
    pendingRefunds, openComplaints, unsentConfirmations, dsrOpen, dsrOverdue, testimonialsQueued, awaitingPayment, arrivals, departures] = await Promise.all([
    num("SELECT COUNT(*) FROM rooms WHERE active=1"),
    rev(m0, t.slice(0, 7) + "-31"),
    rev(prev0 + "-01", prev0 + "-31"),
    num("SELECT COALESCE(SUM(paid),0) FROM bookings WHERE substr(created_at,1,10) BETWEEN ? AND ?", m0, t),
    num("SELECT COALESCE(SUM(paid),0) FROM bookings"),
    num("SELECT COALESCE(SUM(amount),0) FROM refunds WHERE status='paid'"),
    num("SELECT COALESCE(SUM(total-paid),0) FROM bookings WHERE status IN ('confirmed','checked_in','pending')"),
    all<{ check_in: string; check_out: string }>("SELECT check_in,check_out FROM bookings WHERE status IN ('confirmed','checked_in') AND check_in<? AND check_out>?", next30, t),
    num("SELECT COUNT(*) FROM bookings WHERE status='confirmed' AND check_in>=?", t),
    num("SELECT COUNT(*) FROM refunds WHERE status='proposed'"),
    num("SELECT COUNT(*) FROM complaints WHERE status!='resolved'"),
    num("SELECT COUNT(*) FROM bookings WHERE status IN ('confirmed','checked_in') AND confirmation_status IN ('not_sent','failed')"),
    num("SELECT COUNT(*) FROM dsr_requests WHERE status='open'"),
    num("SELECT COUNT(*) FROM dsr_requests WHERE status='open' AND due_date<?", t),
    num("SELECT COUNT(*) FROM testimonials WHERE status='queued'"),
    num("SELECT COUNT(*) FROM bookings WHERE status='pending'"),
    all<{ id: number; code: string; name: string; room: string; check_in: string; total: number; paid: number }>(
      `SELECT b.id,b.code,g.name,r.name room,b.check_in,b.total,b.paid FROM bookings b JOIN guests g ON g.id=b.guest_id JOIN rooms r ON r.id=b.room_id WHERE b.status='confirmed' AND b.check_in BETWEEN ? AND ? ORDER BY b.check_in LIMIT 8`, t, addDays(t, 7)),
    all<{ id: number; code: string; name: string; room: string; check_out: string }>(
      `SELECT b.id,b.code,g.name,r.name room,b.check_out FROM bookings b JOIN guests g ON g.id=b.guest_id JOIN rooms r ON r.id=b.room_id WHERE b.status IN ('checked_in','confirmed') AND b.check_out BETWEEN ? AND ? ORDER BY b.check_out LIMIT 8`, t, addDays(t, 3)),
  ]);
  const activeRooms = activeRoomsRaw || 1;
  let nights30 = 0;
  for (const b of upcoming) nights30 += Math.max(0, nightsBetween(b.check_in < t ? t : b.check_in, b.check_out > next30 ? next30 : b.check_out));
  return {
    collectedAllTime: collectedAllTime - refundedAllTime, refundedAllTime, outstanding, monthRevenue, prevRevenue, collectedThisMonth,
    occupancyNext30: Math.round((nights30 / (activeRooms * 30)) * 100),
    upcomingCount, awaitingPayment, pendingRefunds, openComplaints, unsentConfirmations, dsrOpen, dsrOverdue, testimonialsQueued, arrivals, departures,
  };
}

export async function monthlySeries(months = 12) {
  const t = today();
  const keys: string[] = [];
  const d = new Date(t + "T00:00:00Z");
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - (months - 1));
  for (let i = 0; i < months; i++) { keys.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  // two grouped queries instead of 2×N
  const [good, bad] = await Promise.all([
    all<{ m: string; rev: number; n: number; nights: number }>(
      `SELECT substr(check_in,1,7) m, COALESCE(SUM(total-gst),0) rev, COUNT(*) n, COALESCE(SUM(julianday(check_out)-julianday(check_in)),0) nights
       FROM bookings WHERE status IN ('completed','checked_in','confirmed') AND substr(check_in,1,7)>=? GROUP BY m`, keys[0]),
    all<{ m: string; n: number }>("SELECT substr(check_in,1,7) m, COUNT(*) n FROM bookings WHERE status='cancelled' AND substr(check_in,1,7)>=? GROUP BY m", keys[0]),
  ]);
  return keys.map((month) => {
    const g = good.find((x) => x.m === month), c = bad.find((x) => x.m === month);
    return { month, revenue: g?.rev ?? 0, bookings: g?.n ?? 0, cancelled: c?.n ?? 0, nights: g?.nights ?? 0 };
  });
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

export async function kpis() {
  const [r, roomsRaw, repeat, rating] = await Promise.all([
    one<{ rev: number; nights: number; n: number; canc: number; total: number }>(
      `SELECT COALESCE(SUM(CASE WHEN status IN ('completed','checked_in','confirmed') THEN total-gst END),0) rev,
              COALESCE(SUM(CASE WHEN status IN ('completed','checked_in','confirmed') THEN julianday(check_out)-julianday(check_in) END),0) nights,
              COALESCE(SUM(CASE WHEN status IN ('completed','checked_in','confirmed') THEN 1 ELSE 0 END),0) n,
              COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) canc, COUNT(*) total
       FROM bookings WHERE check_in>=?`, addDays(today(), -365)),
    num("SELECT COUNT(*) FROM rooms WHERE active=1"),
    one<{ r: number | null; t: number }>("SELECT SUM(CASE WHEN c>1 THEN 1 ELSE 0 END) r, COUNT(*) t FROM (SELECT guest_id, COUNT(*) c FROM bookings WHERE status='completed' GROUP BY guest_id)"),
    one<{ a: number | null }>("SELECT AVG(rating) a FROM testimonials WHERE rating IS NOT NULL"),
  ]);
  const rooms = roomsRaw || 1;
  return {
    adr: r.nights ? r.rev / r.nights : 0,
    occupancy: Math.round((r.nights / (rooms * 365)) * 100),
    revpar: r.rev / (rooms * 365),
    avgStay: r.n ? r.nights / r.n : 0,
    cancelRate: r.total ? Math.round((r.canc / r.total) * 100) : 0,
    repeatRate: repeat.t ? Math.round(((repeat.r || 0) / repeat.t) * 100) : 0,
    avgRating: rating.a,
  };
}
