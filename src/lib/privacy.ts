import { db, getSetting, st } from "./db";
import { addDays, today } from "./dates";

/** DPDP Act 2023 / GDPR: right to access -> portable export of everything we hold about a guest. */
export async function exportGuestData(guestId: number) {
  const q = (sql: string) => db.prepare(sql).all(guestId);
  const guest = await db.prepare("SELECT id,name,phone,email,aadhaar_last4,consent_marketing,consent_whatsapp,loyalty_points,created_at FROM guests WHERE id=?").get(guestId);
  return {
    exported_at: new Date().toISOString(), guest,
    bookings: await q("SELECT code,check_in,check_out,adults,children,status,total,paid,coupon_code,created_at FROM bookings WHERE guest_id=?"),
    consents: await q("SELECT purpose,granted,source,notice_version,created_at FROM consents WHERE guest_id=?"),
    loyalty: await q("SELECT points,reason,created_at FROM loyalty_ledger WHERE guest_id=?"),
    emails: await q("SELECT kind,subject,status,created_at FROM emails WHERE guest_id=?"),
    complaints: await q("SELECT subject,status,created_at FROM complaints WHERE guest_id=?"),
    testimonials: await q("SELECT rating,text,status FROM testimonials WHERE guest_id=?"),
    note: "Aadhaar number is stored encrypted and is shown to you only as the last 4 digits.",
  };
}

/**
 * Right to erasure. Financial records (bookings, GST amounts) must be kept for statutory periods (Income-tax/GST: ~6-8 yrs),
 * so we anonymise the person, not the transaction. Blocked while a stay is upcoming/in-house.
 */
export async function eraseGuest(guestId: number): Promise<{ ok: boolean; error?: string }> {
  const live = await db.prepare("SELECT 1 FROM bookings WHERE guest_id=? AND status IN ('confirmed','checked_in','pending')").get(guestId);
  if (live) return { ok: false, error: "Guest has an upcoming or in-house booking. Cancel or complete it first." };
  await db.batch([
    st(`UPDATE guests SET name='Erased guest', phone=NULL, email=NULL, aadhaar_enc=NULL, aadhaar_last4=NULL, aadhaar_purpose=NULL, aadhaar_delete_after=NULL,
       consent_marketing=0, consent_whatsapp=0, notes=NULL, unsub_token=NULL, erased_at=datetime('now') WHERE id=?`, guestId),
    st("UPDATE emails SET to_addr=NULL, from_addr=NULL, body='[erased]' WHERE guest_id=?", guestId),
    st("UPDATE complaints SET body='[erased]' WHERE guest_id=?", guestId),
    st("UPDATE testimonials SET text=NULL WHERE guest_id=?", guestId),
  ]); // consent history is deliberately retained as proof of lawful processing
  return { ok: true };
}

/** Run daily (cron / button): delete Aadhaar past its purpose window, flag old records. */
export async function runRetention() {
  const a = await db.prepare("UPDATE guests SET aadhaar_enc=NULL, aadhaar_last4=NULL, aadhaar_purpose=NULL, aadhaar_delete_after=NULL WHERE aadhaar_enc IS NOT NULL AND aadhaar_delete_after<=?").run(today());
  const years = Number(await getSetting("data_retention_years") || 8);
  const cutoff = addDays(today(), -365 * years);
  const old = (await db.prepare("SELECT COUNT(*) c FROM guests g WHERE erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.guest_id=g.id AND b.check_out>?)").get(cutoff) as { c: number }).c;
  return { aadhaarPurged: a.changes, dormantGuestsPastRetention: old };
}

export const dsrDueDate = (type: string) => addDays(today(), type === "grievance" ? 15 : 30);
