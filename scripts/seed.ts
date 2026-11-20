import crypto from "crypto";
import { db, setSetting } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { createBooking, completeBooking } from "../src/lib/bookings";
import { addDays, today } from "../src/lib/dates";

async function main() {
  if ((db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c > 0) { console.log("Database already has users — not seeding."); return; }
  const email = (process.env.OWNER_EMAIL || "owner@example.com").toLowerCase();
  const pw = process.env.SEED_PASSWORD || crypto.randomBytes(9).toString("base64url") + "aA1";
  db.prepare("INSERT INTO users(email,name,password_hash,role,must_change_password) VALUES (?,?,?,?,1)").run(email, "Owner", await hashPassword(pw), "owner");
  setSetting("property_name", "Misty Hills Homestay (demo)"); setSetting("property_phone", "+91 90000 00000");

  const rooms = [["Tea Estate Suite", "Suite", 4, 6500], ["Garden Deluxe", "Deluxe", 3, 4200], ["Valley View Room", "Deluxe", 2, 3800], ["Cosy Standard", "Standard", 2, 2400], ["Family Cottage", "Cottage", 6, 8200]] as const;
  for (const r of rooms) db.prepare("INSERT INTO rooms(name,type,capacity,base_price,description) VALUES (?,?,?,?,?)").run(...r, "Demo room");
  const y = new Date().getUTCFullYear();
  for (let id = 1; id <= rooms.length; id++) {
    const base = rooms[id - 1][3];
    db.prepare("INSERT INTO room_rates(room_id,label,start_date,end_date,price,priority) VALUES (?,?,?,?,?,1)").run(id, "Peak (Oct–Jan)", `${y}-10-15`, `${y + 1}-01-15`, Math.round(base * 1.4));
    db.prepare("INSERT INTO room_rates(room_id,label,start_date,end_date,price,priority) VALUES (?,?,?,?,?,1)").run(id, "Monsoon off-season", `${y}-06-15`, `${y}-09-15`, Math.round(base * 0.75));
  }
  db.prepare("INSERT INTO providers(name,category,phone,commission_pct) VALUES ('Raju Jeep Safaris','Jeep',?,10),('Estate Guide Co-op','Guide',?,0)").run("+91 90000 00001", "+91 90000 00002");
  db.prepare("INSERT INTO services(name,category,price,unit,included,provider_id) VALUES ('Tea estate walk','Activity',0,'per person',1,2),('Jeep ride to viewpoint','Activity',1800,'per jeep',0,1),('Candle-light dinner','Dining',1500,'per couple',0,NULL),('Breakfast','Dining',0,'per person',1,NULL)").run();
  db.prepare("INSERT INTO coupons(code,description,type,value,max_discount,min_nights,valid_to,per_guest_once,terms) VALUES ('WELCOME10','First stay offer','percent',10,1500,2,?,1,'Min 2 nights. Not combinable with other offers.'),('MONSOON500','Off-season flat discount','flat',500,NULL,1,?,0,'Valid for monsoon-season stays.')").run(addDays(today(), 120), addDays(today(), 60));
  db.prepare("INSERT INTO channels(name,commission_pct) VALUES ('airbnb',3),('booking_com',15),('makemytrip',18)").run();

  // demo history: ~14 months of bookings
  const first = ["Aarav", "Diya", "Rohan", "Meera", "Karthik", "Ananya", "Vikram", "Isha", "Arjun", "Sneha", "Rahul", "Priya", "Neha", "Siddharth", "Kavya", "Manoj"];
  const last = ["Nair", "Menon", "Sharma", "Iyer", "Reddy", "Das", "Gupta", "Pillai", "Joshi", "Rao"];
  const sources = ["website", "website", "direct", "phone", "airbnb", "booking_com", "makemytrip"];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let n = 0;
  for (let d = -420; d < 60; d += 1) {
    if (rnd() > 0.55) continue;
    const ci = addDays(today(), d), nights = 1 + Math.floor(rnd() * 4), co = addDays(ci, nights);
    const gi = Math.floor(rnd() * 28);
    const name = `${first[gi % first.length]} ${last[(gi * 3) % last.length]}`;
    const r = createBooking({
      roomId: 1 + Math.floor(rnd() * rooms.length), checkIn: ci, checkOut: co, adults: 2, children: 0, source: sources[Math.floor(rnd() * sources.length)],
      guest: { name, phone: `+91 9000${String(10000 + gi).slice(-5)}`.replace(/\s/g, ""), email: `demo.guest${gi}@example.com`, consentMarketing: gi % 3 !== 0, consentWhatsapp: gi % 2 === 0 },
      paid: 0, status: "confirmed",
    });
    if (!r.ok) continue;
    n++;
    const b = db.prepare("SELECT id,total FROM bookings WHERE id=?").get(r.id) as { id: number; total: number };
    const cancelled = rnd() < 0.08;
    db.prepare("UPDATE bookings SET paid=?, confirmation_status='sent' WHERE id=?").run(d < 0 || rnd() > 0.5 ? b.total : Math.round(b.total * 0.3), b.id);
    if (cancelled && d > 0) db.prepare("UPDATE bookings SET status='cancelled', cancelled_at=datetime('now'), cancel_reason='Change of plans' WHERE id=?").run(b.id);
    else if (co < today()) completeBooking(b.id, 1);
    else if (ci <= today()) db.prepare("UPDATE bookings SET status='checked_in' WHERE id=?").run(b.id);
  }
  db.prepare("INSERT INTO complaints(subject,body,severity,source) VALUES ('Hot water in the morning','Guest reported water took 20 min to heat.','medium','manual')").run();
  console.log(`Seeded ${n} demo bookings.\n\nLogin: ${email}\nPassword: ${pw}\n(you will be asked to change it on first sign-in)`);
}
main();
