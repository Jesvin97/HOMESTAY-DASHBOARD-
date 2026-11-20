"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, setSetting, getSetting } from "@/lib/db";
import { audit, requireUser, hashPassword, passwordProblem, can, resetMfa } from "@/lib/auth";
import { createBooking, cancelBooking, completeBooking, addPoints, setConsent, storeAadhaar } from "@/lib/bookings";
import { segmentGuests } from "@/lib/marketing";
import { sendBookingConfirmation, sendCancellationEmail, sendMail, syncInbox, unsubLink } from "@/lib/mail";
import { payoutUpi, UPI_RE } from "@/lib/upi";
import { eraseGuest, runRetention, dsrDueDate } from "@/lib/privacy";
import { syncChannel } from "@/lib/ical";
import { decrypt } from "@/lib/crypto";
import { today } from "@/lib/dates";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string, d = 0) => { const v = Number(fd.get(k)); return Number.isFinite(v) && fd.get(k) !== "" ? v : d; };
const b = (fd: FormData, k: string) => fd.get(k) === "on";
const nul = (v: string) => (v === "" ? null : v);
function done(path: string, msg?: string, err?: string): never {
  revalidatePath(path);
  const q = err ? `?err=${encodeURIComponent(err)}` : msg ? `?msg=${encodeURIComponent(msg)}` : "";
  redirect(path.split("?")[0] + q);
}

/* ---------------- bookings ---------------- */
export async function createBookingAction(fd: FormData) {
  const u = await requireUser();
  const services = fd.getAll("service").map((id) => ({ id: Number(id), qty: Math.max(1, n(fd, "qty_" + id, 1)) }));
  const r = await createBooking({
    roomId: n(fd, "room_id"), checkIn: s(fd, "check_in"), checkOut: s(fd, "check_out"), adults: n(fd, "adults", 2), children: n(fd, "children", 0),
    guest: { name: s(fd, "name"), phone: s(fd, "phone"), email: s(fd, "email"), aadhaar: s(fd, "aadhaar") || undefined, consentMarketing: b(fd, "consent_marketing"), consentWhatsapp: b(fd, "consent_whatsapp") },
    source: s(fd, "source") || "direct", services, couponCode: s(fd, "coupon"), redeemPoints: n(fd, "redeem"), paid: n(fd, "paid"), paymentMethod: s(fd, "payment_method") || undefined,
    notes: s(fd, "notes") || undefined, createdBy: u.id,
    commissionPct: (await db.prepare("SELECT commission_pct c FROM channels WHERE lower(name)=lower(?)").get(s(fd, "source")) as { c: number } | undefined)?.c,
  });
  if (!r.ok) done("/bookings/new", undefined, r.error);
  await audit(u, "booking_created", "booking", r.id, { code: r.code });
  done(`/bookings/${r.id}`, "Booking created. Review it, then send the confirmation email.");
}

export async function sendConfirmationAction(fd: FormData) {
  const u = await requireUser();
  const id = n(fd, "id");
  const r = await sendBookingConfirmation(id);
  await audit(u, "confirmation_sent", "booking", id, r);
  done(`/bookings/${id}`, r.status === "sent" ? "Confirmation email sent." : r.status === "dry_run" ? "Dry-run: SMTP isn't configured, so the email was logged but not delivered." : undefined, r.status === "failed" ? "Email failed: " + r.error : undefined);
}

export async function recordPaymentAction(fd: FormData) {
  const u = await requireUser();
  const id = n(fd, "id"), amt = n(fd, "amount");
  const row = await db.prepare("SELECT total,paid FROM bookings WHERE id=?").get(id) as { total: number; paid: number };
  if (amt <= 0 || row.paid + amt > row.total) done(`/bookings/${id}`, undefined, "Amount must be positive and not exceed the balance.");
  await db.prepare("UPDATE bookings SET paid=paid+?, payment_method=? WHERE id=?").run(amt, s(fd, "method") || "upi", id);
  await audit(u, "payment_recorded", "booking", id, { amt });
  done(`/bookings/${id}`, "Payment recorded.");
}

export async function bookingStatusAction(fd: FormData) {
  const u = await requireUser();
  const id = n(fd, "id"), to = s(fd, "to");
  if (to === "checked_in") await db.prepare("UPDATE bookings SET status='checked_in' WHERE id=? AND status='confirmed'").run(id);
  else if (to === "confirmed") await db.prepare("UPDATE bookings SET status='confirmed' WHERE id=? AND status='pending'").run(id);
  else if (to === "completed") completeBooking(id, u.id);
  else if (to === "no_show") await db.prepare("UPDATE bookings SET status='no_show' WHERE id=? AND status='confirmed'").run(id);
  await audit(u, "booking_status", "booking", id, { to });
  done(`/bookings/${id}`, "Updated.");
}

export async function cancelBookingAction(fd: FormData) {
  const u = await requireUser();
  const id = n(fd, "id");
  const override = fd.get("override_pct") !== "" && fd.get("override_pct") != null ? n(fd, "override_pct") : undefined;
  if (override != null && !can(u, "manager")) done(`/bookings/${id}`, undefined, "Only a manager/owner can override the policy refund.");
  let r: Awaited<ReturnType<typeof cancelBooking>>;
  try { r = await cancelBooking(id, s(fd, "reason") || "Cancelled by host", u.id, override); }
  catch (e) { done(`/bookings/${id}`, undefined, (e as Error).message); }
  await audit(u, "booking_cancelled", "booking", id, r);
  if (b(fd, "notify")) await sendCancellationEmail(id, r.refund);
  done(`/bookings/${id}`, r.refund ? `Cancelled. A refund of ₹${r.refund} was PROPOSED — approve it under Refunds.` : "Cancelled. No refund due under policy.");
}

/* ---------------- refunds (human in loop) ---------------- */
export async function setRefundUpiAction(fd: FormData) {
  const u = await requireUser();
  const upi = s(fd, "upi_id");
  if (!UPI_RE.test(upi)) done("/refunds", undefined, "That doesn't look like a valid UPI ID (name@bank).");
  await db.prepare("UPDATE refunds SET upi_id=? WHERE id=? AND status IN ('proposed','approved','failed')").run(upi, n(fd, "id"));
  await audit(u, "refund_upi_set", "refund", n(fd, "id"));
  done("/refunds", "UPI ID saved.");
}
export async function approveRefundAction(fd: FormData) {
  const u = await requireUser("manager");
  const id = n(fd, "id");
  const r = await db.prepare("SELECT r.*, g.name gname FROM refunds r JOIN bookings b ON b.id=r.booking_id JOIN guests g ON g.id=b.guest_id WHERE r.id=?").get(id) as
    { id: number; amount: number; upi_id: string | null; status: string; proposed_by: number | null; gname: string; booking_id: number } | undefined;
  if (!r || !["proposed", "failed"].includes(r.status)) done("/refunds", undefined, "Refund isn't awaiting approval.");
  if (r!.proposed_by === u.id && u.role !== "owner") done("/refunds", undefined, "Four-eyes rule: someone else must approve a refund you proposed (the owner may approve their own).");
  if (!r!.upi_id) done("/refunds", undefined, "Add the guest's UPI ID first.");
  if (s(fd, "confirm") !== String(r!.amount)) done("/refunds", undefined, "Type the exact refund amount to confirm.");
  await db.prepare("UPDATE refunds SET status='approved', approved_by=?, decided_at=datetime('now') WHERE id=?").run(u.id, id);
  const res = await payoutUpi({ upiId: r!.upi_id!, amount: r!.amount, name: r!.gname, reference: "refund-" + id });
  if (res.ok) {
    await db.prepare("UPDATE refunds SET status='paid', provider_ref=?, failure_reason=NULL WHERE id=?").run((res.simulated ? "[SIMULATED] " : "") + res.ref, id);
    await audit(u, "refund_paid", "refund", id, { amount: r!.amount, simulated: !!res.simulated });
    done("/refunds", res.simulated ? "Approved (SIMULATED payout — no money moved; configure RazorpayX to go live)." : "Approved and paid via UPI.");
  }
  await db.prepare("UPDATE refunds SET status='failed', failure_reason=? WHERE id=?").run(res.error, id);
  await audit(u, "refund_failed", "refund", id, res.error);
  done("/refunds", undefined, "Payout failed: " + res.error);
}
export async function rejectRefundAction(fd: FormData) {
  const u = await requireUser("manager");
  await db.prepare("UPDATE refunds SET status='rejected', approved_by=?, decided_at=datetime('now') WHERE id=? AND status IN ('proposed','failed')").run(u.id, n(fd, "id"));
  await audit(u, "refund_rejected", "refund", n(fd, "id"));
  done("/refunds", "Refund rejected.");
}

/* ---------------- rooms, rates, photos ---------------- */
export async function saveRoomAction(fd: FormData) {
  const u = await requireUser("manager");
  const id = n(fd, "id");
  const price = n(fd, "base_price");
  if (price <= 0) done("/rooms", undefined, "Price must be positive.");
  if (id) {
    const old = await db.prepare("SELECT base_price FROM rooms WHERE id=?").get(id) as { base_price: number };
    await db.prepare("UPDATE rooms SET name=?,type=?,capacity=?,base_price=?,description=?,active=? WHERE id=?").run(s(fd, "name"), s(fd, "type"), n(fd, "capacity", 2), price, s(fd, "description"), b(fd, "active") ? 1 : 0, id);
    await audit(u, "room_updated", "room", id, { price_from: old.base_price, price_to: price });
  } else {
    const r = await db.prepare("INSERT INTO rooms(name,type,capacity,base_price,description) VALUES (?,?,?,?,?)").run(s(fd, "name"), s(fd, "type") || "Standard", n(fd, "capacity", 2), price, s(fd, "description"));
    await audit(u, "room_created", "room", Number(r.lastInsertRowid));
  }
  done("/rooms", "Saved.");
}
export async function addRateAction(fd: FormData) {
  const u = await requireUser("manager");
  if (s(fd, "end_date") < s(fd, "start_date")) done("/rooms", undefined, "End date is before start date.");
  await db.prepare("INSERT INTO room_rates(room_id,label,start_date,end_date,price,priority) VALUES (?,?,?,?,?,?)").run(n(fd, "room_id"), s(fd, "label") || "Seasonal", s(fd, "start_date"), s(fd, "end_date"), n(fd, "price"), n(fd, "priority"));
  await audit(u, "rate_added", "room", n(fd, "room_id"), { label: s(fd, "label"), price: n(fd, "price") });
  done("/rooms", "Seasonal rate added.");
}
export async function deleteRateAction(fd: FormData) {
  const u = await requireUser("manager");
  await db.prepare("DELETE FROM room_rates WHERE id=?").run(n(fd, "id"));
  await audit(u, "rate_deleted", "room_rate", n(fd, "id"));
  done("/rooms", "Rate removed.");
}
export async function addPhotoAction(fd: FormData) {
  const u = await requireUser("manager");
  const url = s(fd, "url");
  if (!/^(https:\/\/|\/uploads\/)/.test(url)) done("/rooms", undefined, "Photo URL must start with https:// (upload to your image host/CDN first).");
  await db.prepare("INSERT INTO photos(room_id,url,caption,is_hero) VALUES (?,?,?,?)").run(nul(s(fd, "room_id")), url, s(fd, "caption"), b(fd, "is_hero") ? 1 : 0);
  await audit(u, "photo_added", "photo");
  done("/rooms", "Photo added.");
}
export async function editPhotoAction(fd: FormData) {
  const u = await requireUser("manager");
  await db.prepare("UPDATE photos SET caption=?, is_hero=?, sort=? WHERE id=?").run(s(fd, "caption"), b(fd, "is_hero") ? 1 : 0, n(fd, "sort"), n(fd, "id"));
  await audit(u, "photo_edited", "photo", n(fd, "id"));
  done("/rooms", "Photo updated.");
}
export async function deletePhotoAction(fd: FormData) {
  const u = await requireUser("manager");
  await db.prepare("DELETE FROM photos WHERE id=?").run(n(fd, "id"));
  await audit(u, "photo_deleted", "photo", n(fd, "id"));
  done("/rooms", "Photo removed.");
}
export async function blockRoomAction(fd: FormData) {
  const u = await requireUser();
  if (s(fd, "end_date") <= s(fd, "start_date")) done("/calendar", undefined, "End must be after start.");
  await db.prepare("INSERT INTO room_blocks(room_id,start_date,end_date,reason,source) VALUES (?,?,?,?, 'manual')").run(n(fd, "room_id"), s(fd, "start_date"), s(fd, "end_date"), s(fd, "reason") || "Blocked");
  await audit(u, "room_blocked", "room", n(fd, "room_id"));
  done("/calendar", "Dates blocked.");
}
export async function unblockAction(fd: FormData) {
  const u = await requireUser();
  await db.prepare("DELETE FROM room_blocks WHERE id=? AND source='manual'").run(n(fd, "id"));
  await audit(u, "room_unblocked", "room_block", n(fd, "id"));
  done("/calendar", "Block removed.");
}

/* ---------------- services & providers ---------------- */
export async function saveProviderAction(fd: FormData) {
  const u = await requireUser("manager");
  const id = n(fd, "id");
  if (id) await db.prepare("UPDATE providers SET name=?,category=?,phone=?,email=?,commission_pct=?,active=? WHERE id=?").run(s(fd, "name"), s(fd, "category"), s(fd, "phone"), s(fd, "email"), n(fd, "commission_pct"), b(fd, "active") ? 1 : 0, id);
  else await db.prepare("INSERT INTO providers(name,category,phone,email,commission_pct) VALUES (?,?,?,?,?)").run(s(fd, "name"), s(fd, "category") || "Activity", s(fd, "phone"), s(fd, "email"), n(fd, "commission_pct"));
  await audit(u, "provider_saved", "provider", id || undefined);
  done("/services", "Provider saved.");
}
export async function saveServiceAction(fd: FormData) {
  const u = await requireUser("manager");
  const id = n(fd, "id");
  const vals = [s(fd, "name"), s(fd, "category") || "Activity", n(fd, "price"), s(fd, "unit") || "per person", b(fd, "included") ? 1 : 0, nul(s(fd, "provider_id")), s(fd, "description")];
  if (id) await db.prepare("UPDATE services SET name=?,category=?,price=?,unit=?,included=?,provider_id=?,description=?,active=? WHERE id=?").run(...vals, b(fd, "active") ? 1 : 0, id);
  else await db.prepare("INSERT INTO services(name,category,price,unit,included,provider_id,description) VALUES (?,?,?,?,?,?,?)").run(...vals);
  await audit(u, "service_saved", "service", id || undefined);
  done("/services", "Service saved.");
}

/* ---------------- coupons ---------------- */
export async function saveCouponAction(fd: FormData) {
  const u = await requireUser("manager");
  const code = s(fd, "code").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!code) done("/coupons", undefined, "Code is required.");
  const type = s(fd, "type") === "flat" ? "flat" : "percent";
  const value = n(fd, "value");
  if (value <= 0 || (type === "percent" && value > 100)) done("/coupons", undefined, "Enter a valid discount value.");
  const row = [code, s(fd, "description"), type, value, nul(s(fd, "max_discount")) && n(fd, "max_discount"), n(fd, "min_nights", 1), n(fd, "min_amount"),
    nul(s(fd, "valid_from")), nul(s(fd, "valid_to")), nul(s(fd, "stay_from")), nul(s(fd, "stay_to")), nul(s(fd, "blackout_dates")), nul(s(fd, "room_types")),
    nul(s(fd, "max_uses")) && n(fd, "max_uses"), b(fd, "per_guest_once") ? 1 : 0, b(fd, "first_time_only") ? 1 : 0, b(fd, "weekdays_only") ? 1 : 0, s(fd, "terms")];
  try {
    await db.prepare(`INSERT INTO coupons(code,description,type,value,max_discount,min_nights,min_amount,valid_from,valid_to,stay_from,stay_to,blackout_dates,room_types,max_uses,per_guest_once,first_time_only,weekdays_only,terms)
      VALUES (${row.map(() => "?").join(",")}) ON CONFLICT(code) DO UPDATE SET description=excluded.description,type=excluded.type,value=excluded.value,max_discount=excluded.max_discount,min_nights=excluded.min_nights,min_amount=excluded.min_amount,valid_from=excluded.valid_from,valid_to=excluded.valid_to,stay_from=excluded.stay_from,stay_to=excluded.stay_to,blackout_dates=excluded.blackout_dates,room_types=excluded.room_types,max_uses=excluded.max_uses,per_guest_once=excluded.per_guest_once,first_time_only=excluded.first_time_only,weekdays_only=excluded.weekdays_only,terms=excluded.terms`).run(...row);
  } catch (e) { done("/coupons", undefined, (e as Error).message); }
  await audit(u, "coupon_saved", "coupon", code);
  done("/coupons", `Coupon ${code} saved.`);
}
export async function toggleCouponAction(fd: FormData) {
  const u = await requireUser("manager");
  await db.prepare("UPDATE coupons SET active=1-active WHERE id=?").run(n(fd, "id"));
  await audit(u, "coupon_toggled", "coupon", n(fd, "id"));
  done("/coupons");
}

/* ---------------- guests / privacy ---------------- */
export async function updateGuestAction(fd: FormData) {
  const u = await requireUser();
  const id = n(fd, "id");
  await db.prepare("UPDATE guests SET name=?, phone=?, email=?, notes=? WHERE id=? AND erased_at IS NULL").run(s(fd, "name"), nul(s(fd, "phone")), nul(s(fd, "email").toLowerCase()), s(fd, "notes"), id);
  await setConsent(id, "marketing_email", b(fd, "consent_marketing"), "dashboard_edit");
  await setConsent(id, "whatsapp", b(fd, "consent_whatsapp"), "dashboard_edit");
  await audit(u, "guest_updated", "guest", id);
  done(`/guests/${id}`, "Guest updated.");
}
export async function saveAadhaarAction(fd: FormData) {
  const u = await requireUser();
  const id = n(fd, "id");
  if (!b(fd, "lawful")) done(`/guests/${id}`, undefined, "Tick the box confirming the guest was informed why their ID is collected.");
  try { await storeAadhaar(id, s(fd, "aadhaar")); } catch (e) { done(`/guests/${id}`, undefined, (e as Error).message); }
  await audit(u, "aadhaar_stored", "guest", id);
  done(`/guests/${id}`, `Stored encrypted. It will be auto-deleted ${await getSetting("aadhaar_retention_days")} days after check-out.`);
}
export async function revealAadhaarAction(fd: FormData) {
  const u = await requireUser("owner");
  const id = n(fd, "id");
  const g = await db.prepare("SELECT aadhaar_enc FROM guests WHERE id=?").get(id) as { aadhaar_enc: string | null };
  if (!g.aadhaar_enc) done(`/guests/${id}`, undefined, "No Aadhaar on file.");
  await audit(u, "aadhaar_revealed", "guest", id);
  const d = decrypt(g.aadhaar_enc!);
  done(`/guests/${id}`, "Aadhaar (shown once, access logged): " + d.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3"));
}
export async function deleteAadhaarAction(fd: FormData) {
  const u = await requireUser();
  await db.prepare("UPDATE guests SET aadhaar_enc=NULL,aadhaar_last4=NULL,aadhaar_purpose=NULL,aadhaar_delete_after=NULL WHERE id=?").run(n(fd, "id"));
  await audit(u, "aadhaar_deleted", "guest", n(fd, "id"));
  done(`/guests/${n(fd, "id")}`, "Aadhaar deleted.");
}
export async function eraseGuestAction(fd: FormData) {
  const u = await requireUser("owner");
  const id = n(fd, "id");
  const r = await eraseGuest(id);
  if (!r.ok) done(`/guests/${id}`, undefined, r.error);
  await db.prepare("UPDATE dsr_requests SET status='done', completed_at=datetime('now') WHERE guest_id=? AND type='erasure' AND status='open'").run(id);
  await audit(u, "guest_erased", "guest", id);
  done("/guests", "Guest personal data erased (financial records kept, anonymised).");
}
export async function createDsrAction(fd: FormData) {
  const u = await requireUser();
  const type = s(fd, "type");
  await db.prepare("INSERT INTO dsr_requests(guest_id,requester,type,due_date,notes) VALUES (?,?,?,?,?)").run(nul(s(fd, "guest_id")), s(fd, "requester"), type, dsrDueDate(type), s(fd, "notes"));
  await audit(u, "dsr_created", "dsr", type);
  done("/privacy", "Request logged.");
}
export async function closeDsrAction(fd: FormData) {
  const u = await requireUser("manager");
  await db.prepare("UPDATE dsr_requests SET status='done', completed_at=datetime('now'), notes=COALESCE(notes,'')||?||? WHERE id=?").run("\nClosed: ", s(fd, "outcome"), n(fd, "id"));
  await audit(u, "dsr_closed", "dsr", n(fd, "id"));
  done("/privacy", "Request closed.");
}
export async function logBreachAction(fd: FormData) {
  const u = await requireUser("owner");
  await db.prepare("INSERT INTO breaches(discovered_at,description,data_affected,people_affected,authority_notified,individuals_notified,remediation) VALUES (?,?,?,?,?,?,?)").run(s(fd, "discovered_at") || today(), s(fd, "description"), s(fd, "data_affected"), n(fd, "people_affected"), b(fd, "authority") ? 1 : 0, b(fd, "individuals") ? 1 : 0, s(fd, "remediation"));
  await audit(u, "breach_logged", "breach");
  done("/privacy", "Breach recorded. Notify the Data Protection Board of India / EU supervisory authority (where applicable) within 72 hours.");
}
export async function runRetentionAction() {
  const u = await requireUser("manager");
  const r = await runRetention();
  await audit(u, "retention_run", "system", undefined, r);
  done("/privacy", `Retention run: ${r.aadhaarPurged} Aadhaar record(s) purged; ${r.dormantGuestsPastRetention} dormant guest(s) past retention period to review.`);
}

/* ---------------- complaints / inbox ---------------- */
export async function addComplaintAction(fd: FormData) {
  const u = await requireUser();
  await db.prepare("INSERT INTO complaints(guest_id,booking_id,subject,body,severity,source) VALUES (?,?,?,?,?, 'manual')").run(nul(s(fd, "guest_id")), nul(s(fd, "booking_id")), s(fd, "subject"), s(fd, "body"), s(fd, "severity") || "medium");
  await audit(u, "complaint_logged", "complaint");
  done("/inbox", "Complaint logged.");
}
export async function updateComplaintAction(fd: FormData) {
  const u = await requireUser();
  const st = s(fd, "status");
  await db.prepare("UPDATE complaints SET status=?, resolution=?, resolved_at=CASE WHEN ?='resolved' THEN datetime('now') END WHERE id=?").run(st, s(fd, "resolution"), st, n(fd, "id"));
  await audit(u, "complaint_updated", "complaint", n(fd, "id"), { st });
  done("/inbox", "Complaint updated.");
}
export async function syncInboxAction() {
  const u = await requireUser();
  let r: Awaited<ReturnType<typeof syncInbox>>;
  try { r = await syncInbox(); }
  catch (e) { done("/inbox", undefined, "Mail sync failed: " + (e as Error).message); }
  await audit(u, "inbox_sync", "email", undefined, r);
  done("/inbox", r.note ?? `Imported ${r.imported} new email(s).`);
}

/* ---------------- loyalty ---------------- */
export async function adjustPointsAction(fd: FormData) {
  const u = await requireUser("manager");
  const pts = n(fd, "points");
  if (!pts || !s(fd, "reason")) done("/loyalty", undefined, "Points and a reason are required.");
  await addPoints(n(fd, "guest_id"), pts, s(fd, "reason"), undefined, u.id);
  await audit(u, "points_adjusted", "guest", n(fd, "guest_id"), { pts, reason: s(fd, "reason") });
  done("/loyalty", "Points updated.");
}
export async function saveLoyaltySettingsAction(fd: FormData) {
  const u = await requireUser("owner");
  for (const k of ["loyalty_points_per_100", "loyalty_point_value", "loyalty_welcome_bonus", "loyalty_review_bonus"]) await setSetting(k, String(Math.max(0, n(fd, k))));
  await setSetting("loyalty_tiers", JSON.stringify([{ name: "Member", minStays: 0 }, { name: s(fd, "t1n") || "Silver", minStays: n(fd, "t1m", 3) }, { name: s(fd, "t2n") || "Gold", minStays: n(fd, "t2m", 6) }]));
  await audit(u, "loyalty_settings", "settings");
  done("/loyalty", "Loyalty rules saved.");
}

/* ---------------- marketing ---------------- */
export async function saveCampaignAction(fd: FormData) {
  const u = await requireUser();
  const id = n(fd, "id");
  if (id) await db.prepare("UPDATE campaigns SET name=?,subject=?,body=?,segment=?,status='draft',approved_by=NULL WHERE id=? AND status!='sent'").run(s(fd, "name"), s(fd, "subject"), s(fd, "body"), s(fd, "segment"), id);
  else await db.prepare("INSERT INTO campaigns(name,subject,body,segment,created_by) VALUES (?,?,?,?,?)").run(s(fd, "name"), s(fd, "subject"), s(fd, "body"), s(fd, "segment"), u.id);
  await audit(u, "campaign_saved", "campaign", id || undefined);
  done("/marketing", "Draft saved.");
}
export async function approveCampaignAction(fd: FormData) {
  const u = await requireUser("manager");
  await db.prepare("UPDATE campaigns SET status='approved', approved_by=? WHERE id=? AND status='draft'").run(u.id, n(fd, "id"));
  await audit(u, "campaign_approved", "campaign", n(fd, "id"));
  done("/marketing", "Approved. You can now send it.");
}
export async function sendCampaignAction(fd: FormData) {
  const u = await requireUser("manager");
  const id = n(fd, "id");
  const c = await db.prepare("SELECT * FROM campaigns WHERE id=? AND status='approved'").get(id) as { subject: string; body: string; segment: string } | undefined;
  if (!c) done("/marketing", undefined, "Campaign must be approved before sending.");
  const prop = await getSetting("property_name");
  let sent = 0;
  for (const g of await segmentGuests(c!.segment)) {
    const body = c!.body.replace(/\{\{name\}\}/g, g.name.split(" ")[0]).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
    const link = unsubLink(g.unsub_token);
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px">${body}<hr><p style="font-size:12px;color:#666">You receive this because you opted in to updates from ${prop}. <a href="${link}">Unsubscribe</a> any time.</p></div>`;
    const r = await sendMail({ to: g.email, subject: c!.subject, html, kind: "marketing", guestId: g.id, headers: { "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    if (r.status !== "failed") sent++;
  }
  await db.prepare("UPDATE campaigns SET status='sent', sent_count=?, sent_at=datetime('now') WHERE id=?").run(sent, id);
  await audit(u, "campaign_sent", "campaign", id, { sent });
  done("/marketing", `Sent to ${sent} consented guest(s).${process.env.SMTP_URL ? "" : " (Dry-run: SMTP not configured.)"}`);
}

/* ---------------- testimonials ---------------- */
export async function markRequestedAction(fd: FormData) {
  const u = await requireUser();
  await db.prepare("UPDATE testimonials SET status='requested', requested_at=datetime('now') WHERE id=? AND status='queued'").run(n(fd, "id"));
  await audit(u, "testimonial_requested", "testimonial", n(fd, "id"));
  done("/testimonials");
}
export async function saveTestimonialAction(fd: FormData) {
  const u = await requireUser();
  const id = n(fd, "id");
  const rating = Math.min(5, Math.max(1, n(fd, "rating", 5)));
  await db.prepare("UPDATE testimonials SET status='received', rating=?, text=?, publish=? WHERE id=?").run(rating, s(fd, "text"), b(fd, "publish") ? 1 : 0, id);
  const t = await db.prepare("SELECT guest_id FROM testimonials WHERE id=?").get(id) as { guest_id: number };
  const bonus = Number(await getSetting("loyalty_review_bonus") || 0);
  if (bonus && !await db.prepare("SELECT 1 FROM loyalty_ledger WHERE guest_id=? AND reason='Review bonus' AND booking_id=?").get(t.guest_id, id)) await addPoints(t.guest_id, bonus, "Review bonus", id, u.id);
  await audit(u, "testimonial_saved", "testimonial", id);
  done("/testimonials", "Testimonial saved.");
}

/* ---------------- channels / settings / users ---------------- */
export async function saveChannelAction(fd: FormData) {
  const u = await requireUser("manager");
  const id = n(fd, "id");
  if (id) await db.prepare("UPDATE channels SET name=?,commission_pct=?,room_id=?,ical_url=? WHERE id=?").run(s(fd, "name"), n(fd, "commission_pct"), nul(s(fd, "room_id")), nul(s(fd, "ical_url")), id);
  else await db.prepare("INSERT INTO channels(name,commission_pct,room_id,ical_url) VALUES (?,?,?,?)").run(s(fd, "name"), n(fd, "commission_pct"), nul(s(fd, "room_id")), nul(s(fd, "ical_url")));
  await audit(u, "channel_saved", "channel", id || undefined);
  done("/channels", "Channel saved.");
}
export async function syncChannelAction(fd: FormData) {
  const u = await requireUser("manager");
  const msg = await syncChannel(n(fd, "id"));
  await audit(u, "channel_sync", "channel", n(fd, "id"), msg);
  done("/channels", msg);
}
export async function saveSettingsAction(fd: FormData) {
  const u = await requireUser("owner");
  for (const k of ["property_name", "property_phone", "property_email", "gst_number", "gst_mode", "gst_flat_pct", "services_gst_pct", "grievance_officer_name", "grievance_officer_email", "aadhaar_retention_days", "data_retention_years"])
    if (fd.has(k)) await setSetting(k, s(fd, k));
  const tiers = [0, 1, 2, 3].map((i) => ({ daysBefore: n(fd, `p${i}d`, -1), refundPct: n(fd, `p${i}r`) })).filter((t) => t.daysBefore >= 0 && t.refundPct >= 0 && t.refundPct <= 100);
  if (tiers.length) await setSetting("cancellation_policy", JSON.stringify(tiers));
  await audit(u, "settings_saved", "settings");
  done("/settings", "Settings saved.");
}
export async function addUserAction(fd: FormData) {
  const u = await requireUser("owner");
  const pw = s(fd, "password");
  const problem = passwordProblem(pw);
  if (problem) done("/security", undefined, problem);
  try {
    await db.prepare("INSERT INTO users(email,name,password_hash,role,must_change_password) VALUES (?,?,?,?,1)").run(s(fd, "email").toLowerCase(), s(fd, "name"), await hashPassword(pw), ["owner", "manager", "staff"].includes(s(fd, "role")) ? s(fd, "role") : "staff");
  } catch { done("/security", undefined, "That email already exists."); }
  await audit(u, "user_created", "user", s(fd, "email"));
  done("/security", "User created; they must change the password at first login.");
}
export async function deactivateUserAction(fd: FormData) {
  const u = await requireUser("owner");
  const id = n(fd, "id");
  if (id === u.id) done("/security", undefined, "You can't deactivate yourself.");
  await db.prepare("UPDATE users SET active=0 WHERE id=?").run(id);
  await db.prepare("UPDATE sessions SET revoked=1 WHERE user_id=?").run(id);
  await audit(u, "user_deactivated", "user", id);
  done("/security", "User deactivated and signed out.");
}
export async function revokeSessionsAction() {
  const u = await requireUser("owner");
  await db.prepare("UPDATE sessions SET revoked=1 WHERE user_id!=?").run(u.id);
  await audit(u, "sessions_revoked_all", "session");
  done("/security", "All other sessions signed out.");
}


export async function resetMfaAction(fd: FormData) {
  const u = await requireUser("owner");
  const id = n(fd, "id");
  if (id === u.id) done("/security", undefined, "Use the recovery command for your own account (see README), or ask another owner.");
  await resetMfa(u, id);
  done("/security", "Two-step verification reset. They'll set it up again at next sign-in.");
}
