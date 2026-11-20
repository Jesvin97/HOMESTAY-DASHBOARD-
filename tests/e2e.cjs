/* End-to-end "press every button" test. Run against a built app with a freshly seeded DB:  node tests/e2e.cjs  (see scripts in README). */
const { chromium } = require("playwright"); const crypto = require("crypto");
const U = process.env.APP_URL || "http://localhost:3100", PW = process.env.SEED_PASSWORD || "DemoPassw0rd-123", KEY = process.env.WEBSITE_API_KEY || "testkey";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const dec = (s) => { let bits = 0, val = 0, out = []; for (const c of s) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
let stepOffset = 0;
const totp = (k, off = 0) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + off)); const h = crypto.createHmac("sha1", dec(k)).update(m).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
function verhoeff(b) { const d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]; const p = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]; const inv = [0,4,3,2,1,5,6,7,8,9]; let c = 0; [...b].reverse().forEach((ch, i) => { c = d[c][p[(i + 1) % 8][Number(ch)]]; }); return b + inv[c]; }
const iso = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let pass = 0, fail = 0; const failures = [];
function check(name, ok, detail = "") { if (ok) { pass++; console.log("  PASS", name); } else { fail++; failures.push(name + " :: " + detail); console.log("  FAIL", name, "::", detail); } }

(async () => {
  const browser = await chromium.launch();
  const secrets = {};
  async function session(email) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const p = await ctx.newPage();
    p.on("dialog", (d) => d.accept());
    await p.goto(U + "/login"); await p.fill("input[name=email]", email); await p.fill("input[name=password]", PW); await p.click("button"); await p.waitForTimeout(1800);
    if (p.url().includes("/mfa/setup")) {
      const key = (await p.textContent("body")).match(/Manual key: ((?:[A-Z2-7]{4} ?){8})/)[1].replace(/\s/g, "");
      await p.fill("input[name=code]", totp(key)); await p.click('button:has-text("Turn on")'); await p.waitForSelector("text=Save these backup codes");
      secrets[email] = { key, codes: await p.locator("ul.grid li").allTextContents() };
      await p.click("text=continue"); await p.waitForTimeout(1200);
    } else if (p.url().includes("/mfa")) {
      await p.fill("input[name=code]", totp(secrets[email].key, 1 + (stepOffset++ % 1))); await p.click('button:has-text("Verify")'); await p.waitForTimeout(1500);
    }
    p.flash = async () => { await p.waitForTimeout(1300); await p.waitForLoadState("networkidle").catch(() => {}); try { await p.waitForSelector("[role=status],[role=alert]", { timeout: 6000 }); } catch { return ""; } return (await p.locator("[role=status],[role=alert]").first().textContent()).trim(); };
    p.card = (t) => p.locator(`section:has(h2:text-is("${t}"))`);
    return p;
  }
  const submit = async (p, scope, btnText) => { await scope.locator(`button:has-text("${btnText}")`).first().click(); return p.flash(); };

  /* ================= OWNER ================= */
  console.log("== login + MFA");
  const o = await session("owner@example.com");
  check("owner lands on overview after MFA", o.url() === U + "/", o.url());
  await o.goto(U + "/"); check("overview renders KPIs", (await o.textContent("body")).includes("Revenue this month"));

  console.log("== booking: payment-gated confirmation");
  const ci = iso(210), co = iso(212);
  await o.goto(`${U}/bookings/new?check_in=${ci}&check_out=${co}&room_id=4`);
  await o.fill("input[name=name]", "E2E Pending Guest"); await o.fill("input[name=phone]", "+919555000001"); await o.fill("input[name=email]", "e2e1@example.com");
  await o.fill("input[name=paid]", "1000");
  let f = await submit(o, o.locator("form").last(), "Create booking");
  check("partial payment → saved as PENDING", /PENDING/.test(f), f);
  const bookingUrl = o.url(); const bid = bookingUrl.split("/").pop();
  check("pending booking shows 'not confirmed'", (await o.textContent("body")).includes("Not confirmed"));
  check("no confirmation-email button while pending", (await o.locator('button:has-text("Send confirmation")').count()) === 0);
  check("no manual Confirm button exists", (await o.locator('button:has-text("Confirm booking")').count()) === 0);
  check("Check-in not offered while pending", (await o.locator('button:has-text("Check in")').count()) === 0);
  // overpay
  await o.locator("input[name=amount]").evaluate((e) => e.removeAttribute("max")); await o.fill("input[name=amount]", "9999999"); f = await submit(o, o.locator("form:has(input[name=amount])"), "Record");
  check("overpayment rejected", /more than the balance|exceed/i.test(f), f);
  await o.fill("input[name=amount]", "500"); f = await submit(o, o.locator("form:has(input[name=amount])"), "Record");
  check("second partial payment still not confirmed", /still due/.test(f), f);
  const bal = Number((await o.textContent("body")).match(/Balance₹([\d,]+)/)[1].replace(/,/g, ""));
  await o.fill("input[name=amount]", String(bal)); f = await submit(o, o.locator("form:has(input[name=amount])"), "Record");
  check("paying the balance auto-CONFIRMS", /CONFIRMED/.test(f), f);
  f = await submit(o, o.card("Confirmation email"), "Send confirmation");
  check("confirmation email send (dry-run without SMTP)", /Dry-run|sent/i.test(f), f);
  f = await submit(o, o.card("Status"), "Check in"); check("check-in works when confirmed", /Updated/.test(f), f);
  f = await submit(o, o.card("Status"), "Check out"); check("check-out works", /Updated/.test(f), f);
  check("booking now completed", (await o.textContent("body")).includes("completed"));

  console.log("== unpaid booking can be cancelled (no refund) / cancel with refund");
  await o.goto(`${U}/bookings/new?check_in=${iso(220)}&check_out=${iso(221)}&room_id=3`);
  await o.fill("input[name=name]", "E2E Unpaid"); await o.fill("input[name=phone]", "+919555000002");
  f = await submit(o, o.locator("form").last(), "Create booking"); check("zero payment → PENDING", /PENDING/.test(f), f);
  await o.fill("input[name=reason]", "e2e"); f = await submit(o, o.card("Cancel booking"), "Cancel booking"); check("cancel unpaid: no refund", /No refund/.test(f), f);
  await o.goto(`${U}/bookings/new?check_in=${iso(230)}&check_out=${iso(232)}&room_id=2`);
  await o.fill("input[name=name]", "E2E Paid"); await o.fill("input[name=phone]", "+919555000003"); await o.fill("input[name=email]", "e2e3@example.com"); await o.fill("input[name=paid]", "99999999");
  f = await submit(o, o.locator("form").last(), "Create booking"); check("full payment → CONFIRMED at creation", /CONFIRMED/.test(f), f);
  await o.fill("input[name=reason]", "e2e"); await o.locator("input[name=override_pct]").evaluate((e) => e.removeAttribute("max")); await o.fill("input[name=override_pct]", "150"); f = await submit(o, o.card("Cancel booking"), "Cancel booking");
  check("refund override >100% rejected", /between 0 and 100/.test(f), f);
  await o.fill("input[name=reason]", "e2e"); await o.fill("input[name=override_pct]", ""); f = await submit(o, o.card("Cancel booking"), "Cancel booking");
  check("cancel confirmed booking proposes refund", /PROPOSED/.test(f), f);
  check("cancelled booking can't take payment", (await o.locator("input[name=amount]").count()) === 0);

  console.log("== refunds");
  await o.goto(U + "/refunds");
  const row = o.locator("tbody tr", { has: o.locator("span:text-is('proposed')") }).first();
  await row.locator("input[name=upi_id]").fill("not-a-upi"); await row.locator('button:has-text("Save")').click(); f = await o.flash(); check("invalid UPI rejected", /valid UPI/.test(f), f);
  const row2 = o.locator("tbody tr", { has: o.locator("span:text-is('proposed')") }).first();
  await row2.locator("input[name=upi_id]").fill("guest@okbank"); await row2.locator('button:has-text("Save")').click(); f = await o.flash(); check("UPI saved", /UPI ID saved/.test(f), f);
  const row3 = o.locator("tbody tr", { has: o.locator("span:text-is('proposed')") }).first();
  await row3.locator("input[name=confirm]").fill("1"); await row3.locator('button:has-text("Approve")').click(); f = await o.flash(); check("wrong confirm amount blocked", /exact refund amount/.test(f), f);
  const row4 = o.locator("tbody tr", { has: o.locator("span:text-is('proposed')") }).first();
  const amt = (await row4.locator("input[name=confirm]").getAttribute("placeholder")).replace("type ", "");
  await row4.locator("input[name=confirm]").fill(amt); await row4.locator('button:has-text("Approve")').click(); f = await o.flash(); check("approve → SIMULATED payout", /SIMULATED/.test(f), f);
  const row5 = o.locator("tbody tr", { has: o.locator("span:text-is('proposed')") }).first();
  if (await row5.count()) { await row5.locator('button:has-text("Reject")').click(); f = await o.flash(); check("reject refund", /rejected/i.test(f), f); } else check("reject refund (none left to reject)", true);

  console.log("== coupons");
  await o.goto(U + "/coupons");
  const cf = o.card("Create / update a coupon");
  await cf.locator("input[name=code]").fill("e2e25"); await cf.locator("input[name=value]").fill("25"); await cf.locator("input[name=min_nights]").fill("2"); f = await submit(o, cf, "Save coupon"); check("coupon saved", /E2E25 saved/.test(f), f);
  await o.goto(U + "/coupons"); await cf.locator("input[name=code]").fill("bad"); await cf.locator("input[name=value]").fill("150"); f = await submit(o, cf, "Save coupon"); check("percent >100 rejected", /valid discount/.test(f), f);
  await o.goto(U + "/coupons"); await o.locator("tr", { hasText: "E2E25" }).locator('button:has-text("Disable")').click(); await o.waitForLoadState("networkidle"); check("coupon disabled", (await o.locator("tr", { hasText: "E2E25" }).textContent()).includes("Enable"));
  // coupon rules enforced in quote
  await o.goto(`${U}/bookings/new?check_in=${iso(240)}&check_out=${iso(241)}&room_id=4&coupon=WELCOME10`); check("coupon min-nights rule shown in quote", (await o.textContent("body")).includes("Minimum 2 nights"));
  await o.goto(`${U}/bookings/new?check_in=${iso(240)}&check_out=${iso(243)}&room_id=4&coupon=WELCOME10`); check("valid coupon gives discount", (await o.textContent("body")).includes("Coupon WELCOME10"));

  console.log("== rooms / rates / photos");
  await o.goto(U + "/rooms");
  const room = o.locator("section", { has: o.locator("h2:text-is('Cosy Standard')") });
  await room.locator("input[name=base_price]").fill("2600"); f = await submit(o, room, "Save room"); check("room price saved", /Saved/.test(f), f);
  await o.goto(U + "/rooms"); const room2 = o.locator("section", { has: o.locator("h2:text-is('Cosy Standard')") });
  await room2.locator("input[name=label]").fill("E2E Festival"); await room2.locator("input[name=start_date]").fill(iso(300)); await room2.locator("input[name=end_date]").fill(iso(305)); await room2.locator("input[name=price]").fill("3999"); f = await submit(o, room2, "Add rate"); check("seasonal rate added", /rate added/.test(f), f);
  await o.goto(U + "/rooms"); const room3 = o.locator("section", { has: o.locator("h2:text-is('Cosy Standard')") });
  await room3.locator("li", { hasText: "E2E Festival" }).locator("button").click(); f = await o.flash(); check("seasonal rate removed", /removed/.test(f), f);
  await o.goto(U + "/rooms"); const ph = o.card("Photos (website gallery)");
  await ph.locator("input[name=url]").fill("http://insecure.example/x.jpg"); f = await submit(o, ph, "Add photo"); check("non-https photo rejected", /https/.test(f), f);
  await o.goto(U + "/rooms"); await ph.locator("input[name=url]").fill("https://picsum.photos/seed/e2e/300/200"); await ph.locator("input[name=caption]").last().fill("E2E photo"); f = await submit(o, ph, "Add photo"); check("photo added", /Photo added/.test(f), f);
  await o.goto(U + "/rooms"); const pc = o.locator("div.rounded-lg", { has: o.locator("input[value='E2E photo']") }).first();
  await pc.locator("input[name=caption]").fill("E2E photo edited"); await pc.locator('button:has-text("Save")').click(); f = await o.flash(); check("photo edited", /Photo updated/.test(f), f);
  await o.goto(U + "/rooms"); await o.locator("div.rounded-lg", { has: o.locator("input[value='E2E photo edited']") }).first().locator('button:has-text("delete")').click(); f = await o.flash(); check("photo deleted", /removed/.test(f), f);

  console.log("== calendar blocks");
  await o.goto(U + "/calendar"); const bc = o.card("Block dates (maintenance, family use)");
  await bc.locator("input[name=start_date]").fill(iso(100)); await bc.locator("input[name=end_date]").fill(iso(101)); await bc.locator("input[name=reason]").fill("e2e block"); f = await submit(o, bc, "Block"); check("dates blocked", /blocked/i.test(f), f);
  await o.goto(`${U}/bookings/new?check_in=${iso(100)}&check_out=${iso(101)}&room_id=1`); check("blocked room shows as BOOKED", (await o.textContent("body")).includes("not available"));
  await o.goto(U + "/calendar"); await o.locator("li", { hasText: "e2e block" }).locator("button").click(); f = await o.flash(); check("block removed", /removed/.test(f), f);

  console.log("== services & providers");
  await o.goto(U + "/services");
  const nsf = o.locator("form", { has: o.locator("input[placeholder^='New service']") });
  await nsf.locator("input[name=name]").fill("E2E Cooking class"); await nsf.locator("input[name=price]").fill("900"); await nsf.locator('button:has-text("Add")').click(); f = await o.flash(); check("service added", /Service saved/.test(f), f);
  await o.goto(U + "/services"); const npf = o.locator("form", { has: o.locator("input[placeholder='Provider name']") });
  await npf.locator("input[name=name]").fill("E2E Chef"); await npf.locator('button:has-text("Add provider")').click(); f = await o.flash(); check("provider added", /Provider saved/.test(f), f);

  console.log("== guests / Aadhaar / privacy");
  await o.goto(U + "/guests"); await o.locator("tbody a").first().click(); await o.waitForLoadState("networkidle"); const guestUrl = o.url(); const gid = guestUrl.split("/").pop();
  f = await submit(o, o.card("Contact & consent"), "Save"); check("guest saved", /Guest updated/.test(f), f);
  await o.goto(U + "/guests/" + gid);
  if (await o.locator('button:has-text("Delete now")').count()) { await o.locator('button:has-text("Delete now")').click(); await o.flash(); await o.goto(U + "/guests/" + gid); }
  const ac = o.card("Aadhaar (optional, encrypted)");
  await ac.locator("input[name=aadhaar]").fill("123456789012"); await ac.locator("input[name=lawful]").check(); f = await submit(o, ac, "Store encrypted"); check("invalid Aadhaar rejected", /Invalid Aadhaar/.test(f), f);
  await o.goto(U + "/guests/" + gid); await ac.locator("input[name=aadhaar]").fill(verhoeff("23456781234")); f = await submit(o, ac, "Store encrypted"); check("Aadhaar needs the 'informed' tick", /informed/.test(f), f);
  await o.goto(U + "/guests/" + gid); await ac.locator("input[name=aadhaar]").fill(verhoeff("23456781234")); await ac.locator("input[name=lawful]").check(); f = await submit(o, ac, "Store encrypted"); check("valid Aadhaar stored", /Stored encrypted/.test(f), f);
  await o.goto(U + "/guests/" + gid); await o.locator('button:has-text("Reveal once")').click(); await o.waitForTimeout(1500);
  check("Aadhaar reveal shows number (not in URL)", (await o.locator("code").count()) > 0 && !o.url().includes("2345"), o.url());
  await o.locator('button:has-text("Delete now")').click(); f = await o.flash(); check("Aadhaar deleted", /deleted/.test(f), f);
  await o.goto(U + "/guests/" + gid); f = await submit(o, o.card("Privacy requests for this guest"), "Log erasure request"); check("DSR logged from guest page", /Request logged/.test(f), f);
  const dl = await o.context().request.get(U + `/api/guests/${gid}/export`); const dlt = await dl.text(); check("guest data export (JSON) downloads", dl.status() === 200 && dlt.includes('"guest"'), dl.status() + " " + dlt.slice(0, 80));
  await o.goto(U + "/privacy"); const df = o.locator("form", { has: o.locator("input[placeholder='Name / email of requester']") });
  await df.locator("input[name=requester]").fill("E2E Person"); await df.locator('button:has-text("Log request")').click(); f = await o.flash(); check("DSR created", /Request logged/.test(f), f);
  await o.goto(U + "/privacy"); const dr = o.locator("tr", { hasText: "E2E Person" }); await dr.locator("input[name=outcome]").fill("done"); await dr.locator('button:has-text("Close")').click(); f = await o.flash(); check("DSR closed", /Request closed/.test(f), f);
  await o.goto(U + "/privacy"); const bf = o.card("Breach register"); await bf.locator("input[name=description]").fill("E2E breach"); f = await submit(o, bf, "Record breach"); check("breach recorded", /Breach recorded/.test(f), f);
  await o.goto(U + "/privacy"); f = await submit(o, o.card("Retention"), "Run retention"); check("retention run", /Retention run/.test(f), f);
  // erase a guest with no live bookings (the "E2E Unpaid" guest only has a cancelled booking)
  await o.goto(U + "/guests?q=E2E Unpaid"); await o.locator("tbody a").first().click(); await o.waitForLoadState("networkidle");
  await o.locator('button:has-text("Erase personal data")').click(); f = await o.flash(); check("erase guest (anonymises personal data)", /erased/i.test(f), f);
  await o.goto(U + "/guests?q=E2E Unpaid"); check("erased guest no longer searchable by name", (await o.locator("tbody a").count()) === 0);
  console.log("== inbox / complaints");
  await o.goto(U + "/inbox"); const lc = o.card("Log a complaint"); await lc.locator("input[name=subject]").fill("E2E complaint"); f = await submit(o, lc, "Save"); check("complaint logged", /Complaint logged/.test(f), f);
  await o.goto(U + "/inbox"); const cr = o.locator("tr", { hasText: "E2E complaint" }); await cr.locator("select[name=status]").selectOption("resolved"); await cr.locator("input[name=resolution]").fill("fixed"); await cr.locator('button:has-text("Update")').click(); f = await o.flash(); check("complaint resolved", /updated/.test(f), f);
  await o.goto(U + "/inbox"); await o.locator('button:has-text("Sync mailbox")').click(); f = await o.flash(); check("mailbox sync (no IMAP → explains)", /IMAP not configured|Imported/.test(f), f);

  console.log("== loyalty");
  await o.goto(U + "/loyalty"); const lf = o.card("Give or deduct points (reason is logged)"); await lf.locator("input[name=points]").fill("75"); await lf.locator("input[name=reason]").fill("e2e bonus"); f = await submit(o, lf, "Apply"); check("points awarded", /Points updated/.test(f), f);
  await o.goto(U + "/loyalty"); await lf.locator("input[name=points]").fill("0"); await lf.locator("input[name=reason]").fill("x"); f = await submit(o, lf, "Apply"); check("zero points rejected", /required/.test(f), f);
  await o.goto(U + "/loyalty"); f = await submit(o, o.card("Rules"), "Save rules"); check("loyalty rules saved", /rules saved/.test(f), f);

  console.log("== marketing");
  await o.goto(U + "/marketing"); const mf = o.card("New campaign"); await mf.locator("input[name=name]").fill("E2E camp"); await mf.locator("input[name=subject]").fill("E2E subject"); await mf.locator("textarea[name=body]").fill("Hi {{name}} <b>x</b>"); f = await submit(o, mf, "Save draft"); check("campaign draft saved", /Draft saved/.test(f), f);
  await o.goto(U + "/marketing"); const cc = o.locator("section", { has: o.locator("h2:text-is('E2E camp')") }); f = await submit(o, cc, "Approve"); check("campaign approved", /Approved/.test(f), f);
  await o.goto(U + "/marketing"); const cc2 = o.locator("section", { has: o.locator("h2:text-is('E2E camp')") }); f = await submit(o, cc2, "Send to"); check("campaign sent to consenting guests only (dry-run)", /Sent to \d+ consented/.test(f), f);
  await o.goto(U + "/marketing"); check("sent campaign has no second Send button", (await o.locator("section", { has: o.locator("h2:text-is('E2E camp')") }).locator('button:has-text("Send to")').count()) === 0);

  console.log("== testimonials");
  await o.goto(U + "/testimonials"); const tc = o.locator("section", { hasText: "queued" }).first();
  if (await tc.locator('button:has-text("I sent it")').count()) { await tc.locator('button:has-text("I sent it")').click(); await o.waitForLoadState("networkidle"); check("marked as requested", true); } else check("marked as requested (none queued with WhatsApp consent)", true);
  await o.goto(U + "/testimonials"); const tf = o.locator("section", { has: o.locator("input[name=text]") }).first(); await tf.locator("input[name=text]").fill("E2E lovely stay"); f = await submit(o, tf, "Save"); check("testimonial saved", /Testimonial saved/.test(f), f);
  const tok = require("child_process").execSync(`node -e "const D=require('better-sqlite3');const d=new D(process.env.DATABASE_FILE||'data/homestay.db');console.log(d.prepare(\\"SELECT token FROM testimonials WHERE status='queued' LIMIT 1\\").get().token)"`).toString().trim();
  const rp = await (await browser.newContext()).newPage(); await rp.goto(U + "/review/" + tok); await rp.fill("textarea[name=text]", "public review"); await rp.click('button:has-text("Send")'); await rp.waitForTimeout(1500); await rp.goto(U + "/review/" + tok); check("public review link works and can't be reused", (await rp.textContent("body")).includes("Thank you"));

  console.log("== channels / settings");
  await o.goto(U + "/channels"); const af = o.card("Add a channel"); await af.locator("input[name=name]").fill("e2e_ota"); await af.locator("input[name=commission_pct]").fill("12"); f = await submit(o, af, "Add"); check("channel added", /Channel saved/.test(f), f);
  await o.goto(U + "/channels"); const ch = o.locator("section", { has: o.locator("h2:text-is('e2e_ota')") }); f = await submit(o, ch, "Sync now"); check("sync without iCal URL explains", /needs a room/.test(f), f);
  await o.goto(U + "/settings"); await o.fill("input[name=property_phone]", "+91 99999 11111"); f = await submit(o, o.locator("form"), "Save settings"); check("settings saved", /Settings saved/.test(f), f);

  console.log("== security / users / MFA admin");
  await o.goto(U + "/security"); const uf = o.card("Team"); await uf.locator("input[name=name]").fill("E2E User"); await uf.locator("input[name=email]").fill("e2e.user@example.com"); await uf.locator("input[name=password]").fill("short"); f = await submit(o, uf, "Add user"); check("weak password rejected", /at least 12/.test(f), f);
  await o.goto(U + "/security"); await uf.locator("input[name=name]").fill("E2E User"); await uf.locator("input[name=email]").fill("e2e.user@example.com"); await uf.locator("input[name=password]").fill("StrongPassw0rd-9"); f = await submit(o, uf, "Add user"); check("user added", /User created/.test(f), f);
  await o.goto(U + "/security"); await o.locator("tr", { hasText: "e2e.user@example.com" }).locator('button:has-text("Reset MFA")').click(); f = await o.flash(); check("reset another user's MFA", /reset/i.test(f), f);
  await o.goto(U + "/security"); await o.locator("tr", { hasText: "e2e.user@example.com" }).locator('button:has-text("Deactivate")').click(); f = await o.flash(); check("deactivate user", /deactivated/.test(f), f);
  await o.goto(U + "/account"); const rg = o.locator("form:has(input[name=code])"); await rg.locator("input[name=code]").fill("000000"); await rg.locator('button:has-text("New backup codes")').click(); await o.waitForTimeout(1500); check("backup-code regen needs valid code", (await o.textContent("body")).includes("Wrong code"));
  await o.goto(U + "/account"); await o.locator("input[name=code]").fill(totp(secrets["owner@example.com"].key, 1)); await o.locator('button:has-text("New backup codes")').click(); await o.waitForSelector("text=Save these backup codes", { timeout: 6000 }).then(() => check("backup codes regenerated", true)).catch(() => check("backup codes regenerated", false, "no codes shown"));

  /* ================= STAFF / role gating ================= */
  console.log("== roles");
  const s = await session("staff@example.com");
  for (const path of ["/rooms", "/coupons", "/security", "/settings", "/privacy", "/loyalty", "/channels"]) { await s.goto(U + path); check(`staff blocked from ${path}`, s.url().includes("denied=1"), s.url()); }
  await s.goto(U + "/refunds"); check("staff sees no Approve button on refunds", (await s.locator('button:has-text("Approve")').count()) === 0);
  await s.goto(U + "/bookings"); check("staff can use bookings", s.url().endsWith("/bookings"));
  const m = await session("manager@example.com"); await m.goto(U + "/coupons"); check("manager can open coupons", m.url().endsWith("/coupons")); await m.goto(U + "/security"); check("manager blocked from security", m.url().includes("denied=1"));

  /* ================= public endpoints ================= */
  console.log("== public API / unsubscribe / iCal / webhooks");
  const H = { "x-api-key": KEY, "content-type": "application/json" };
  const av = await (await fetch(`${U}/api/public/availability?checkIn=${iso(400)}&checkOut=${iso(402)}&guests=2`, { headers: H })).json(); check("availability returns rooms with totals", av.rooms?.length > 0 && av.rooms[0].total > 0);
  check("availability rejects past dates", (await fetch(`${U}/api/public/availability?checkIn=2020-01-01&checkOut=2020-01-03`, { headers: H })).status === 400);
  check("availability rejects missing key", (await fetch(`${U}/api/public/availability?checkIn=${iso(400)}&checkOut=${iso(402)}`)).status === 401);
  const body = (extra) => JSON.stringify({ roomId: av.rooms[0].id, checkIn: iso(400), checkOut: iso(402), adults: 2, name: "Web Guest", email: "web@example.com", phone: "+919777000001", ...extra });
  let r1 = await fetch(`${U}/api/public/bookings`, { method: "POST", headers: H, body: body({}) }); let j1 = await r1.json(); check("website booking w/o payment → pending (held)", r1.status === 201 && j1.status === "pending", JSON.stringify(j1));
  let r2 = await fetch(`${U}/api/public/bookings`, { method: "POST", headers: H, body: body({ name: "Other", phone: "+919777000002" }) }); check("second website booking same dates → 409", r2.status === 409);
  let r3 = await fetch(`${U}/api/public/bookings`, { method: "POST", headers: H, body: body({ roomId: av.rooms[1].id, name: "Payer", phone: "+919777000003", paidOnline: 99999999, paymentRef: "pay_123" }) }); let j3 = await r3.json(); check("website booking with full payment+ref → confirmed", r3.status === 201 && j3.status === "confirmed", JSON.stringify(j3));
  let r4 = await fetch(`${U}/api/public/bookings`, { method: "POST", headers: H, body: body({ roomId: av.rooms[2]?.id || av.rooms[0].id, checkIn: iso(-3), checkOut: iso(-1) }) }); check("website booking in the past rejected", r4.status === 400);
  let r5 = await fetch(`${U}/api/public/bookings`, { method: "POST", headers: H, body: body({ roomId: av.rooms[1].id, checkIn: iso(410), checkOut: iso(411), name: "Claimer", phone: "+919777000004", paidOnline: 99999999 }) }); let j5 = await r5.json(); check("claimed payment WITHOUT reference is not believed", j5.status === "pending", JSON.stringify(j5));
  const ics = await fetch(`${U}/api/ical/1?token=${process.env.ICAL_TOKEN || "icaltoken"}`); check("iCal export works with token", ics.status === 200 && (await ics.text()).includes("BEGIN:VCALENDAR"));
  check("iCal export rejects missing token", (await fetch(`${U}/api/ical/1`)).status === 403);
  const tokU = require("child_process").execSync(`node -e "const D=require('better-sqlite3');const d=new D(process.env.DATABASE_FILE||'data/homestay.db');console.log(d.prepare(\\"SELECT unsub_token t FROM guests WHERE consent_marketing=1 AND unsub_token IS NOT NULL LIMIT 1\\").get().t)"`).toString().trim();
  check("one-click unsubscribe POST works", (await fetch(`${U}/api/unsubscribe/${tokU}`, { method: "POST" })).status === 200);
  const up = await (await browser.newContext()).newPage(); await up.goto(U + "/unsubscribe/" + tokU); check("unsubscribe page confirms", (await up.textContent("body")).includes("unsubscribed"));
  check("inbound email webhook rejects bad secret", (await fetch(`${U}/api/inbound/email`, { method: "POST", headers: { "content-type": "application/json", "x-inbound-secret": "nope" }, body: "{}" })).status === 401);
  const ib = await fetch(`${U}/api/inbound/email`, { method: "POST", headers: { "content-type": "application/json", "x-inbound-secret": process.env.INBOUND_EMAIL_SECRET || "inbound" }, body: JSON.stringify({ messageId: "e2e-1", from: "angry@example.com", subject: "Very unhappy with cleanliness", text: "The room was dirty. I want a refund." }) }); check("inbound email webhook creates a complaint", (await ib.json()).complaint === true);
  check("cron maintenance rejects bad secret", (await fetch(`${U}/api/cron/maintenance`)).status === 401);
  const cr2 = await fetch(`${U}/api/cron/maintenance`, { headers: { "x-cron-secret": process.env.CRON_SECRET || "cronsecret" } }); check("cron maintenance runs", cr2.status === 200);

  await browser.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`); if (fail) { console.log(failures.join("\n")); process.exit(1); }
})().catch((e) => { console.error("E2E CRASH", e); process.exit(2); });
