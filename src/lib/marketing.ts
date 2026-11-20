import { db } from "./db";

export function segmentGuests(segment: string) {
  const base = "SELECT id,name,email,unsub_token FROM guests WHERE erased_at IS NULL AND consent_marketing=1 AND email IS NOT NULL";
  const sql = segment === "repeat" ? `${base} AND (SELECT COUNT(*) FROM bookings WHERE guest_id=guests.id AND status='completed')>1`
    : segment === "past_year" ? `${base} AND EXISTS (SELECT 1 FROM bookings WHERE guest_id=guests.id AND check_in>=date('now','-365 day'))`
    : segment === "lapsed" ? `${base} AND NOT EXISTS (SELECT 1 FROM bookings WHERE guest_id=guests.id AND check_in>=date('now','-365 day'))`
    : segment === "gold" ? `${base} AND (SELECT COUNT(*) FROM bookings WHERE guest_id=guests.id AND status='completed')>=6` : base;
  return db.prepare(sql).all() as { id: number; name: string; email: string; unsub_token: string }[];
}
