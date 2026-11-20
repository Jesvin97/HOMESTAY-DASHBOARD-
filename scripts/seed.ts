/**
 * Demo data so EVERY section of the dashboard has something to look at and test.
 * All guests/phones/emails are fake (example.com). Safe to run only on an empty database.
 */
import crypto from "crypto";
import { db, setSetting } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { createBooking, completeBooking, cancelBooking, recordPayment, storeAadhaar, addPoints } from "../src/lib/bookings";
import { addDays, today } from "../src/lib/dates";

function verhoeff(b: string) {
  const d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const p = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  const inv = [0,4,3,2,1,5,6,7,8,9]; let c = 0;
  [...b].reverse().forEach((ch, i) => { c = d[c][p[(i + 1) % 8][Number(ch)]]; });
  return b + inv[c];
}

async function main() {
  if (((await db.prepare("SELECT COUNT(*) c FROM users").get()) as { c: number }).c > 0) { console.log("Database already has users — not seeding."); return; }
  const email = (process.env.OWNER_EMAIL || "owner@example.com").toLowerCase();
  const rp = () => crypto.randomBytes(9).toString("base64url") + "aA1";
  const creds: [string, string, string][] = [["owner", email, process.env.SEED_PASSWORD || rp()], ["manager", "manager@example.com", process.env.SEED_PASSWORD || rp()], ["staff", "staff@example.com", process.env.SEED_PASSWORD || rp()]];
  for (const [role, em, pw] of creds) await db.prepare("INSERT INTO users(email,name,password_hash,role,must_change_password) VALUES (?,?,?,?,1)").run(em, role[0].toUpperCase() + role.slice(1) + " (demo)", await hashPassword(pw), role);

  for (const [k, v] of Object.entries({ property_name: "Misty Hills Homestay (DEMO)", property_phone: "+91 90000 00000", property_email: "bookings@example.com", gst_number: "00DEMO0000A1Z0", grievance_officer_name: "Demo Officer", grievance_officer_email: "privacy@example.com" })) await setSetting(k, v);

  const rooms = [["Tea Estate Suite", "Suite", 4, 6500], ["Garden Deluxe", "Deluxe", 3, 4200], ["Valley View Room", "Deluxe", 2, 3800], ["Cosy Standard", "Standard", 2, 2400], ["Family Cottage", "Cottage", 6, 8200]] as const;
  for (const r of rooms) await db.prepare("INSERT INTO rooms(name,type,capacity,base_price,description) VALUES (?,?,?,?,?)").run(...r, "Demo room description.");
  const y = new Date().getUTCFullYear();
  for (let id = 1; id <= rooms.length; id++) {
    const base = rooms[id - 1][3];
    await db.prepare("INSERT INTO room_rates(room_id,label,start_date,end_date,price,priority) VALUES (?,?,?,?,?,1)").run(id, "Peak (Oct–Jan)", `${y}-10-15`, `${y + 1}-01-15`, Math.round(base * 1.4));
    await db.prepare("INSERT INTO room_rates(room_id,label,start_date,end_date,price,priority) VALUES (?,?,?,?,?,1)").run(id, "Monsoon off-season", `${y}-06-15`, `${y}-09-15`, Math.round(base * 0.75));
  }
  for (const [i, u] of ["tea-estate", "valley-view", "garden", "cottage", "dining"].entries())
    await db.prepare("INSERT INTO photos(room_id,url,caption,is_hero,sort) VALUES (?,?,?,?,?)").run(i < 4 ? Math.min(i + 1, 5) : null, `https://picsum.photos/seed/${u}/640/420`, `Demo photo: ${u}`, i === 0 ? 1 : 0, i);
  await db.prepare("INSERT INTO providers(name,category,phone,commission_pct) VALUES ('Raju Jeep Safaris','Jeep','+91 90000 00001',10),('Estate Guide Co-op','Guide','+91 90000 00002',0),('Hilltop Kitchen','Dining','+91 90000 00003',5)").run();
  await db.prepare("INSERT INTO services(name,category,price,unit,included,provider_id) VALUES ('Tea estate walk','Activity',0,'per person',1,2),('Jeep ride to viewpoint','Activity',1800,'per jeep',0,1),('Candle-light dinner','Dining',1500,'per couple',0,3),('Breakfast','Dining',0,'per person',1,NULL),('Bonfire evening','Activity',600,'per group',0,NULL)").run();
  await db.prepare("INSERT INTO coupons(code,description,type,value,max_discount,min_nights,valid_to,per_guest_once,first_time_only,terms) VALUES ('WELCOME10','First stay offer','percent',10,1500,2,?,1,1,'Min 2 nights. First-time guests only.')").run(addDays(today(), 120));
  await db.prepare("INSERT INTO coupons(code,description,type,value,min_nights,valid_to,terms) VALUES ('MONSOON500','Off-season flat discount','flat',500,1,?,'Valid for monsoon-season stays.')").run(addDays(today(), 60));
  await db.prepare("INSERT INTO coupons(code,description,type,value,min_nights,weekdays_only,room_types,max_uses,terms) VALUES ('MIDWEEK15','Sun–Thu stays','percent',15,2,1,'Deluxe,Standard',50,'Sun–Thu nights only, Deluxe/Standard rooms.')").run();
  await db.prepare("INSERT INTO coupons(code,description,type,value,min_nights,valid_to,active,terms) VALUES ('OLDDEAL','Expired + disabled example','percent',20,1,?,0,'Disabled.')").run(addDays(today(), -30));
  await db.prepare("INSERT INTO channels(name,commission_pct) VALUES ('airbnb',3),('booking_com',15),('makemytrip',18)").run();

  const first = ["Aarav", "Diya", "Rohan", "Meera", "Karthik", "Ananya", "Vikram", "Isha", "Arjun", "Sneha", "Rahul", "Priya", "Neha", "Siddharth", "Kavya", "Manoj"];
  const last = ["Nair", "Menon", "Sharma", "Iyer", "Reddy", "Das", "Gupta", "Pillai", "Joshi", "Rao"];
  const sources = ["website", "website", "direct", "phone", "airbnb", "booking_com", "makemytrip"];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const T = today(); let n = 0; const stat: Record<string, number> = {};
  const bump = (k: string) => (stat[k] = (stat[k] || 0) + 1);
  for (let d = -420; d < 75; d++) {
    if (rnd() > 0.5) continue;
    const ci = addDays(T, d), nights = 1 + Math.floor(rnd() * 4), co = addDays(ci, nights);
    const gi = Math.floor(rnd() * 28);
    const name = `${first[gi % first.length]} ${last[(gi * 3) % last.length]}`;
    const past = co <= T, inhouse = ci <= T && co > T;
    const mode = past || inhouse ? "full" : rnd() < 0.55 ? "full" : rnd() < 0.65 ? "partial" : "none";
    const r = await createBooking({
      roomId: 1 + Math.floor(rnd() * rooms.length), checkIn: ci, checkOut: co, adults: 2, children: 0, source: sources[Math.floor(rnd() * sources.length)],
      guest: { name, phone: `+91900001${String(1000 + gi).slice(-4)}`, email: `demo.guest${gi}@example.com`, consentMarketing: gi % 3 !== 0, consentWhatsapp: gi % 2 === 0 },
      paid: mode === "full" ? 1e9 : 0, paymentMethod: "upi",
    });
    if (!r.ok) continue;
    n++;
    const b = (await db.prepare("SELECT id,total FROM bookings WHERE id=?").get(r.id)) as { id: number; total: number };
    if (mode === "partial") await recordPayment(b.id, Math.round(b.total * 0.3), "upi");
    if (r.status === "confirmed") await db.prepare("UPDATE bookings SET confirmation_status=? WHERE id=?").run(rnd() < 0.85 || past ? "sent" : "not_sent", b.id);
    if (past) { await completeBooking(b.id, 1); bump("completed"); }
    else if (inhouse) { await db.prepare("UPDATE bookings SET status='checked_in' WHERE id=?").run(b.id); bump("checked_in"); }
    else if (rnd() < 0.3 && r.status === "confirmed") { await cancelBooking(b.id, "Change of plans", 1); bump("cancelled"); }
    else bump(r.status);
  }
  // refunds in every state
  const rf = (await db.prepare("SELECT id FROM refunds ORDER BY id").all()) as { id: number }[];
  if (rf[0]) await db.prepare("UPDATE refunds SET upi_id='guest1@okbank' WHERE id=?").run(rf[0].id);
  if (rf[1]) await db.prepare("UPDATE refunds SET status='paid', upi_id='guest2@okaxis', provider_ref='[SIMULATED] SIM-DEMO1', approved_by=1, decided_at=datetime('now') WHERE id=?").run(rf[1].id);
  if (rf[2]) await db.prepare("UPDATE refunds SET status='rejected', approved_by=1, decided_at=datetime('now') WHERE id=?").run(rf[2].id);
  if (rf[3]) await db.prepare("UPDATE refunds SET status='failed', upi_id='bad@upi', failure_reason='Demo: beneficiary bank declined' WHERE id=?").run(rf[3].id);

  // Aadhaar (fake but checksum-valid) for two guests
  const gs = (await db.prepare("SELECT id FROM guests ORDER BY id LIMIT 2").all()) as { id: number }[];
  for (const [i, g] of gs.entries()) await storeAadhaar(g.id, verhoeff(`2345678${String(9010 + i).padStart(4, "0")}`));

  // complaints, emails, loyalty, testimonials, campaigns, privacy
  const gid = async (k: number) => ((await db.prepare("SELECT id FROM guests ORDER BY id LIMIT 1 OFFSET ?").get(k)) as { id: number } | undefined)?.id ?? null;
  const g0 = await gid(0), g1 = await gid(1), g2 = await gid(2), g3 = await gid(3);
  await db.prepare("INSERT INTO complaints(guest_id,subject,body,severity,status,source,resolution,resolved_at) VALUES (?,?,?,?,?,?,?,?)").run(g0, "Hot water in the morning", "Water took 20 minutes to heat.", "medium", "open", "manual", null, null);
  await db.prepare("INSERT INTO complaints(guest_id,subject,body,severity,status,source) VALUES (?,?,?,?,?,?)").run(g1, "Booking refund not received", "Cancelled last week, still no refund.", "high", "in_progress", "email");
  await db.prepare("INSERT INTO complaints(guest_id,subject,body,severity,status,source,resolution,resolved_at) VALUES (?,?,?,?,?,?,?,datetime('now'))").run(g2, "Noisy neighbours", "Loud music till late.", "low", "resolved", "manual", "Spoke to the other guests; offered a free breakfast.");
  await db.prepare("INSERT INTO emails(direction,kind,guest_id,from_addr,to_addr,subject,body,status,message_id) VALUES ('in','inbound',?,?,?,?,?,'received','demo-1')").run(g1, "demo.guest1@example.com", "bookings@example.com", "Booking refund not received", "Cancelled last week, still no refund.");
  await db.prepare("INSERT INTO emails(direction,kind,guest_id,from_addr,to_addr,subject,body,status) VALUES ('out','booking_confirmation',?,?,?,?,?,'sent')").run(g0, "bookings@example.com", "demo.guest0@example.com", "Booking confirmed (demo)", "Demo body");
  await db.prepare("INSERT INTO emails(direction,kind,guest_id,from_addr,to_addr,subject,body,status,error) VALUES ('out','booking_confirmation',?,?,?,?,?,'failed','Demo: mailbox full')").run(g3, "bookings@example.com", "demo.guest3@example.com", "Booking confirmed (demo)", "Demo body");
  if (g0) await addPoints(g0, 200, "Stayed at our sister homestay (demo)", undefined, 1);
  await db.prepare("INSERT INTO campaigns(name,subject,body,segment,status,created_by,approved_by,sent_count,sent_at) VALUES ('Monsoon offer (sent)','Monsoon escape — 15% off','Hi {{name}}, enjoy 15% off midweek stays.','past_year','sent',1,1,12,datetime('now','-10 days'))").run();
  await db.prepare("INSERT INTO campaigns(name,subject,body,segment,status,created_by,approved_by) VALUES ('Winter peak (approved)','Book winter early','Hi {{name}}, winter dates are open.','all_consented','approved',2,1)").run();
  await db.prepare("INSERT INTO campaigns(name,subject,body,segment,status,created_by) VALUES ('Win-back (draft)','We miss you','Hi {{name}}, come back with code WELCOME10.','lapsed','draft',2)").run();
  const tq = (await db.prepare("SELECT id,guest_id FROM testimonials ORDER BY id DESC LIMIT 9").all()) as { id: number; guest_id: number }[];
  const quotes = ["Magical mornings in the tea estate!", "Spotless rooms and warm hosts.", "Best homestay food we've had.", "Peaceful, scenic, great value."];
  for (const [i, t] of tq.entries()) {
    if (i < 4) await db.prepare("UPDATE testimonials SET status='received', rating=?, text=?, publish=? WHERE id=?").run(5 - (i === 3 ? 1 : 0), quotes[i], i < 3 ? 1 : 0, t.id);
    else if (i < 6) await db.prepare("UPDATE testimonials SET status='requested', requested_at=datetime('now') WHERE id=?").run(t.id);
  }
  await db.prepare("INSERT INTO dsr_requests(guest_id,requester,type,due_date,notes) VALUES (?,?,?,?,?)").run(g2, "Demo requester", "access", addDays(T, 20), "Wants a copy of data");
  await db.prepare("INSERT INTO dsr_requests(guest_id,requester,type,due_date,notes) VALUES (?,?,?,?,?)").run(g3, "Demo requester 2", "erasure", addDays(T, -3), "OVERDUE demo");
  await db.prepare("INSERT INTO dsr_requests(requester,type,due_date,status,completed_at,notes) VALUES (?,?,?,'done',datetime('now'),?)").run("Demo requester 3", "withdraw_consent", addDays(T, -10), "Closed: consent withdrawn");
  await db.prepare("INSERT INTO breaches(discovered_at,description,data_affected,people_affected,authority_notified,individuals_notified,remediation) VALUES (?,?,?,?,1,0,?)").run(addDays(T, -40), "DEMO: staff laptop lost (encrypted)", "Names, phones", 0, "Laptop remote-wiped");
  await db.prepare("INSERT INTO room_blocks(room_id,start_date,end_date,reason,source) VALUES (2,?,?,'Repainting','manual')").run(addDays(T, 40), addDays(T, 43));

  console.log(`Seeded ${n} demo bookings: ${JSON.stringify(stat)}\n`);
  console.log("Demo logins (each must change password, then set up an authenticator app):");
  for (const [role, em, pw] of creds) console.log(`  ${role.padEnd(8)} ${em.padEnd(22)} ${pw}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
