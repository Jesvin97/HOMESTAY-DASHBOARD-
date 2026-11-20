# What I need from you, section by section

Nothing here blocks the app from running on demo data — but each section only becomes *real* once you supply its row.
**B** = blocks go-live · **S** = soon after · **O** = optional. "Where" = where it goes (a screen, or a secret in Cloudflare).

## 1. Login & security
| Need | Why | Where | |
|---|---|---|---|
| Owner's real email + a strong password (12+ chars) | First account | `OWNER_EMAIL` env + `npm run seed`/Security page | B |
| Each teammate's name, email, role (owner / manager / staff) | One login per person, never shared | Security → Team | B |
| Phones with an authenticator app (Google/Microsoft Authenticator, Authy…) | Free two-step login | Prompted at first sign-in | B |
| `SESSION_SECRET`, `DATA_KEY` (random 64-hex each, **back up DATA_KEY**) | Sign sessions / encrypt Aadhaar | Cloudflare secrets | B |
| Preferred idle timeout (default 15 min) | Auto sign-out | `IDLE_TIMEOUT_MIN` | O |

## 2. Database (Cloudflare D1)
| Need | Where | |
|---|---|---|
| Cloudflare **Account ID**, **D1 Database ID** | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID` | B |
| API token with *D1 → Edit* (and *Workers Scripts → Edit* to deploy) | secret `CLOUDFLARE_API_TOKEN` | B |
| Is the existing D1 empty, or does it already have tables? If it has tables, export their schema | Avoids clashing table names | B |

## 3. Property & business details (Settings)
Property name · guest phone · business email · **GSTIN** (or "not registered") · GST method (slab / flat / none) · GST % on services · address for invoices · Grievance Officer name+email (DPDP/GDPR) · timezone (default IST). **B**

## 4. Rooms & pricing (Rooms)
For every room: name, type, max guests, description, **base price/night**. Peak/off-season date ranges and their prices (e.g. Oct 15–Jan 15, monsoon). Corporate / group rates, if any (not built yet — see QUESTIONS). **B**

## 5. Photos (Rooms → Photos)
High-quality property / room / surroundings / experience photos as **HTTPS links** (upload to Cloudflare Images / R2 / Cloudinary first). Mark one as the hero image. Logo file (PNG/SVG) for the website. **B for website, O for dashboard**

## 6. Services, experiences & providers (Services)
Each activity (guided tour, jeep ride, tea-estate walk, dining packages…): price, per-person/per-group, **included in tariff or charged extra**. Each provider: name, category, phone, email, commission %. **S**

## 7. Coupons (Coupons)
Codes, % or flat, caps, minimum nights/amount, booking and stay windows, blackout dates, room types, usage limits, terms text. **O**

## 8. Cancellation & refund policy (Settings)
Up to 4 rows: "cancelled ≥ N days before check-in → X% refund". Also **payment hold hours** (how long a booking with no payment holds a room; default 24 h). **B** — refunds are computed from this.

## 9. Payments & UPI refunds
| Need | Where | |
|---|---|---|
| Business PAN / how guests will pay in (UPI/gateway) — the *website's* checkout must send paid bookings with a payment reference | Website integration | B |
| RazorpayX (or similar) account + `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER` for **automated UPI payouts** | Cloudflare secrets | S (until then refunds are **simulated**) |
| Who may approve refunds (manager/owner) | Security → Team | B |

## 10. Email — confirmations, cancellations, marketing
Business domain + mailbox (e.g. bookings@yourdomain). For sending: a **Resend** API key (`RESEND_API_KEY`, works on Cloudflare) *or* SMTP details (`SMTP_URL`, Node hosts only) and `MAIL_FROM`. Verified sending domain (SPF/DKIM). `APP_URL` for links. **B for guest emails**

## 11. Complaints from the mailbox
Either IMAP details (`IMAP_HOST/USER/PASSWORD` — Node hosts only) **or** Cloudflare Email Routing → a small Email Worker that POSTs to `/api/inbound/email` with `INBOUND_EMAIL_SECRET`. **S**

## 12. WhatsApp testimonials
Nothing technical today: a person taps "Open WhatsApp & send". For fully automatic sending later: WhatsApp Business Cloud API access + an approved message template. Text of your testimonial request message. **O**

## 13. Email marketing & consent
Your privacy notice URL, marketing consent wording used on the website form, brand footer/address (legal requirement in emails). **S**

## 14. Loyalty (Loyalty)
Points per ₹100, ₹ value of a point, welcome bonus, review bonus, tier names & stay thresholds. **O**

## 15. OTA channels (Channels)
Which platforms (Airbnb, Booking.com, MakeMyTrip), **commission %** each, and each platform's **iCal export URL** per room. Give each OTA our iCal export link (needs `ICAL_TOKEN`). **S**

## 16. Website ↔ dashboard
`WEBSITE_API_KEY` (shared secret the website sends as `x-api-key`) and the website developer must: call `/api/public/availability`, POST `/api/public/bookings`, and only send `paidOnline` + `paymentRef` **after verifying the payment gateway callback**. **B**

## 17. Privacy (DPDP / GDPR)
Grievance Officer; retention periods (Aadhaar days after check-out; financial records years); who handles access/erasure requests; your breach contact. Have a lawyer review the privacy notice. **B**

## 18. Hosting & domain
Cloudflare account; domain on Cloudflare DNS (or tell me where it is); custom hostname for the dashboard (e.g. desk.yourdomain.in). **B**
