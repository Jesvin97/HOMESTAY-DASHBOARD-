# Questions for you (answer when you're back — nothing was blocked on these; I chose the safe default noted)

1. **The "1000 faulty" list** — where did you see it? Paste or attach it and I'll check each item against the code/tests. I audited independently meanwhile (AUDIT.md).
2. **Cloudflare Pages vs Workers.** I configured *Workers* (Pages' replacement; Pages can't run this app's Node code). OK? *Default: Workers.*
3. **Deployment credentials.** I can't deploy without your Cloudflare account. Either run the 8 steps in DEPLOY.md, or give me access by adding `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets and run the *Deploy to Cloudflare* workflow. (Don't paste tokens in chat.)
4. **Is the existing D1 empty?** If it already has tables, send the schema; my `CREATE TABLE IF NOT EXISTS` won't alter existing tables. *Default: use a new empty D1.*
5. **Hold period for unpaid bookings** — 24 h, and part-paid bookings are never auto-cancelled (a human decides, refund policy applies). OK, or different? Do you want the **website** to hold a room while the guest pays (e.g. 15 min) instead?
6. **"Full amount" for OTA bookings** (Airbnb/Booking.com/MMT): the platform collects the money. I treat an OTA booking as paid when you enter the full amount (method "Paid via OTA"). OK?
7. **Corporate / group packages & rates** — not built (coupons approximate it). Want a proper group-quote feature? What rules?
8. **Email sending**: Resend (HTTPS, works on Cloudflare) vs your Google Workspace SMTP (won't work on Workers). Which mailbox/domain will the guest emails come from?
9. **Complaints mailbox**: is it Gmail/Workspace? (IMAP can't run on Workers — I'd use Cloudflare Email Routing → webhook.)
10. **WhatsApp**: manual one-tap sending now. Do you want to apply for the official WhatsApp Business API for automatic sending? (Needs Meta business verification.)
11. **GST**: the 0/12/18% slab by nightly rate is a default — please have the owner's CA confirm, and tell me the GSTIN.
12. **Aadhaar**: keep optional, 30-day post-stay deletion? Many homestays use another ID instead; consider dropping Aadhaar entirely.
13. **Logo & photo upload** — currently links only. Want real uploads into Cloudflare R2/Images?
14. **Production owner account** — want a `create-owner` script (clean start, no demo data)? *Default: use seed then delete demo rows, or I add the script on request.*
15. **Who are Kevin and Jesvin in the project** (roles)? I emailed both a project summary (no secrets). Tell me if either should get dashboard logins, and with what role.
16. **Email notifications to the owner** (new pending booking, refund awaiting approval, overdue DSR) — want them? Currently shown on the Overview only.
