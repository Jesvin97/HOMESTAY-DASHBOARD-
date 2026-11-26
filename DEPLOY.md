# Deploying to Cloudflare

**Pages vs Workers.** You asked for Cloudflare *Pages*. Cloudflare now steers new Next.js apps to **Workers (with static assets)** — the old Pages adapter (`next-on-pages`) is deprecated and only runs Edge-runtime code, while this app needs Node APIs (crypto for Aadhaar encryption, bcrypt, etc.). The Workers build is the same product family, same dashboard, same `*.workers.dev` / custom-domain setup. This repo is already configured for it (`wrangler.jsonc`, `open-next.config.ts`).
**I could not deploy for you**: that needs your Cloudflare account. The Worker bundle builds, and the full 105-step button test passes on the real Workers runtime (workerd) against a stand-in D1 — but not against *your* Cloudflare account.

## One-time setup (≈15 min)

```bash
npm ci
npx wrangler login                       # opens a browser; or export CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
```

1. **Database.** Use your existing D1 *if it is empty*; otherwise create a fresh one:
   `npx wrangler d1 create homestay` → note the `database_id`.
   Apply the schema: `npx wrangler d1 execute homestay --remote --file=migrations/0001_init.sql`
2. **API token for the app → D1** (the app calls D1's REST API): Cloudflare dashboard → My Profile → API Tokens → *Create custom token* → **Account · D1 · Edit**. Copy the token.
3. **Secrets** (each prompts for the value; never commit them):
   ```bash
   for n in SESSION_SECRET DATA_KEY CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_D1_DATABASE_ID CLOUDFLARE_API_TOKEN \
            WEBSITE_API_SECRET CASHFREE_APP_ID CASHFREE_SECRET_KEY CASHFREE_ENV ICAL_TOKEN CRON_SECRET INBOUND_EMAIL_SECRET APP_URL RESEND_API_KEY MAIL_FROM; do
     npx wrangler secret put $n; done
   ```
   `SESSION_SECRET`, `DATA_KEY`: `openssl rand -hex 32`. **Back up `DATA_KEY`** — without it stored Aadhaar numbers are unreadable.
4. **First owner login** (run locally with the same D1 values exported):
   `OWNER_EMAIL=you@yourdomain.in npm run seed` seeds *demo* data too. For a clean production start run only `npm run db:migrate`, then create the owner with a one-off SQL insert — or ask me for a `create-owner` script (see QUESTIONS.md).
5. **Deploy:** `npm run cf:deploy`  (or GitHub → Actions → *Deploy to Cloudflare* → Run workflow, after adding repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).
6. **Domain:** Workers & Pages → homestay-dashboard → Settings → Domains → add `desk.yourdomain.in`. Set `APP_URL` to it.
7. **Hourly maintenance** (releases unpaid holds, purges expired Aadhaar): add repo secrets `APP_URL` + `CRON_SECRET`; the *Hourly maintenance* workflow then calls `/api/cron/maintenance`.
8. **Protect it**: Cloudflare Access (free for ≤50 users) in front of the whole hostname is a cheap extra layer on top of password + MFA; add a WAF rate-limit rule on `/login` and `/api/public/*`.

## Local preview in the Workers runtime
Create `.dev.vars` (gitignored) with the same keys, then `npm run cf:preview`.

## Known differences on Cloudflare
- **No raw SMTP / IMAP sockets** → send mail with `RESEND_API_KEY`; receive complaints via Email Routing → `/api/inbound/email`.
- Each DB query is an HTTPS round-trip to D1 (~tens of ms). A native D1 *binding* would be faster; it is a contained change in `src/lib/db.ts` if you want it.
- Rate limiting in code is per-instance; rely on Cloudflare WAF rules for real limits.
