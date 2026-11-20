# Homestay Desk — owner dashboard

**Docs:** [DATA_NEEDED.md](DATA_NEEDED.md) (what each section needs from you) · [DEPLOY.md](DEPLOY.md) (Cloudflare) · [AUDIT.md](AUDIT.md) (logic audit) · [QUESTIONS.md](QUESTIONS.md) (open questions)

> **Booking rule:** a booking is *confirmed only when the full amount is received*; until then it is *pending* and holds the room for a limited time.


Next.js 15 + SQLite (better-sqlite3). One database is shared by the dashboard **and** the website, so a booking made by the owner, the website or an OTA feed shows up everywhere and can't be double-sold.

## Database: Cloudflare D1

The app talks to **Cloudflare D1** through its REST API when `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID` and `CLOUDFLARE_API_TOKEN` are set; otherwise it uses a local SQLite file (dev/tests). Same SQL either way.

```bash
# 1. create an API token: Cloudflare dashboard → My Profile → API Tokens → Custom → Account · D1 · Edit
# 2. put the 3 values in .env (account id + database id are on the D1 database page)
npm run db:migrate   # creates the tables IF NOT EXISTS (see migrations/0001_init.sql — or run it with `wrangler d1 execute`)
npm run seed         # optional demo data + first owner login
```
Notes: D1 has no interactive transactions, so multi-step writes use atomic batches, and the double-booking guard is a single conditional `INSERT … WHERE NOT EXISTS`. Each query is an HTTPS call, so pages are a little slower than local SQLite; hosting the app on Cloudflare (Workers/Pages with a D1 *binding*) would remove that hop but needs the D1 client swapped for the binding. If your existing D1 already has tables with these names, migrate to a **new** database (or tell me your schema) — `CREATE TABLE IF NOT EXISTS` will not alter an existing table.

## Login & MFA (free)

Password **plus** a 6-digit code from any authenticator app (Google/Microsoft Authenticator, Authy, 1Password…). TOTP per RFC 6238 — no SMS, no cost. First sign-in forces enrolment (QR code), then shows 10 single-use backup codes (stored hashed). Replay-protected, ±30 s clock drift, 5 wrong codes locks the account 15 min and kills its sessions. Owner can reset a teammate's MFA on `/security`; if the *owner* loses phone and codes: `npm run mfa:reset -- owner@email` (needs server/D1 access). Set `MFA_REQUIRED=false` only for local development.

## Run it

```bash
cp .env.example .env     # fill in SESSION_SECRET and DATA_KEY at least (openssl rand -hex 32)
npm install
npm run seed             # demo data + prints the owner login ONCE (must change password on first login)
npm run dev              # http://localhost:3000
npm run e2e              # presses every button (needs a built+running app, see tests/e2e.cjs header)
npm test                 # pricing, coupons, concurrent double-booking, refunds, Aadhaar checksum, TOTP (RFC 6238 vectors), backup codes
```

Production: `npm run build && npm start` behind HTTPS. `SESSION_SECRET` and `DATA_KEY` are mandatory in production (the app refuses to start without them). Back up `data/homestay.db` **and** keep `DATA_KEY` safe — without it encrypted Aadhaar values cannot be read.
With D1 configured the app can run on any Node host including Vercel.

## What's in it

| Need | Where |
|---|---|
| Bookings, amount earned, past bookings, search | `/bookings` (upcoming / past / cancelled), `/` overview |
| Graphs & KPIs (revenue, ADR, RevPAR, occupancy, cancellations, source mix, room mix) | `/`, `/reports` |
| Customer name / phone / email, optional Aadhaar | `/guests` (Aadhaar AES-256-GCM encrypted, shown masked, owner-only logged reveal, auto-delete after stay) |
| Owner creates bookings → same DB as website | `/bookings/new`; website uses `POST /api/public/bookings` & `GET /api/public/availability` (`x-api-key`) |
| Confirmation email sent? | Per-booking status + one-click (re)send; `/inbox` email log |
| Complaints from mail | `/inbox` — IMAP sync (when `IMAP_*` set) + manual log |
| Cancellation by owner + UPI refund | Booking page → **proposes** refund per policy → `/refunds` → manager approves (type the amount; proposer ≠ approver) → payout |
| Coupons with rules | `/coupons` — %/flat, caps, min nights/amount, booking & stay windows, blackout dates, room types, weekdays-only, once-per-guest, first-time, max uses |
| Room prices, seasonal (peak/off) rates | `/rooms` (every price change is audit-logged) |
| Extra services, activities, providers | `/services` (included in tariff vs charged, provider + commission) |
| Photos (incl. hero image) | `/rooms` — add/edit/delete by HTTPS URL |
| Loyalty | `/loyalty` — points per ₹100, welcome/review bonus, tiers, manual awards (e.g. stay at a sister homestay), redemption at booking |
| Email marketing | `/marketing` — only opted-in guests, segments, draft → approve → send, unsubscribe link + header |
| Testimonials on WhatsApp | `/testimonials` — see note below |
| OTA / double-booking | `/channels` (iCal import/export, commission tracking) + `/calendar` |
| DPDP + GDPR | `/privacy` — consent log, access/erasure/withdrawal tracker with deadlines, data export, erasure (anonymise, keep tax records), retention job, breach register, grievance officer |
| Security | bcrypt, 12+ char passwords, lock after 5 fails, 15-min idle + 8-h absolute timeout (enforced server-side), revocable sessions, httpOnly/SameSite=Strict cookies, security headers, roles (owner/manager/staff), audit log, per-IP throttle |

### Human-in-the-loop points
Cancellation never moves money · refunds need manager approval + typed amount · marketing needs approval before send · website bookings arrive as **pending** · Aadhaar reveal is owner-only and logged · erasure is owner-only.

### Things to know (honest limits)
- **WhatsApp**: I did *not* automate WhatsApp Web. Scripted sending breaks WhatsApp's ToS and gets numbers banned. The page queues consenting guests and opens a pre-filled `wa.me` chat — one tap per guest. For hands-off sending use the WhatsApp Business Cloud API with an approved template.
- **UPI refunds** run in **simulation mode** until `RAZORPAYX_*` is set; the RazorpayX adapter (`src/lib/upi.ts`) is written to their documented flow but is untested against a live account — test in their sandbox first. Auto-collecting guest payments (UPI collect/Razorpay checkout) is not included.
- **Aadhaar**: collecting it is legally sensitive. Collect only if needed, with a stated purpose; the default retention is 30 days after check-out (configurable). Passport/licence usually suffice.
- **GST** slabs (0/12/18% by nightly tariff) are a default — confirm with the owner's CA.
- **Legal**: this is engineering support for DPDP/GDPR, not legal advice. Get a privacy notice and DPA reviewed.
- Mail sync, iCal sync and retention run on button press; schedule them with cron hitting the actions if you want them automatic.
- No automated browser tests beyond the 6 unit tests; I smoke-tested every page, the cancel→refund flow, public API, double-booking rejection and idle timeout manually.

## From the website developer's email: what belongs in this dashboard

Already supported: seasonal pricing (peak/off), coupon codes, activities included vs charged (+ extra cost), per-room rates, GST % and GSTIN, cancellation/refund policy (also drives refund amounts), business email (SMTP), UPI, OTA commission + two-way iCal sync with a single availability calendar, hero image flag, business phone.

Still open — need the owner's answers or extra work:
1. **Corporate / group packages** — currently approximated with coupons (min nights/amount, room types). A proper group-rate/quote feature isn't built.
2. **Logo & extra photos** — dashboard stores photo URLs; there is no file upload/hosting yet (needs S3/Cloudinary/Vercel Blob).
3. **Domain, business email, PAN/UPI merchant onboarding** — non-code decisions; set `SMTP_URL`/`MAIL_FROM` once the business mailbox exists.
4. **Published cancellation policy** — enter it under Settings; the same text must appear on the website's T&Cs.
5. **Per-OTA commission rates** — enter under Channels so net revenue is accurate.
