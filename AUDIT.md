# Logic & button audit

**Honest scope.** You mentioned seeing "1000" faults. I can't see that list, so I did not take it as a target: I audited the code and **tested every button and form** end-to-end rather than inventing a count. Below is every defect I actually found and fixed. **If you have the list, send it — QUESTIONS.md #1 — and I'll check each item.**

Verification now in the repo:
- `npm test` — 18 unit/regression tests (pricing, GST, coupons, concurrent double-booking, refunds, payment rule, hold expiry, consent, points, timezone, TOTP RFC vectors, backup codes).
- `npm run e2e` — **105 browser checks** that press every button/form on every page as owner, manager and staff, plus the public API/webhooks. Passes on Node/SQLite **and** on the Cloudflare Workers runtime against a D1-style REST backend.
- CI (`.github/workflows/ci.yml`) runs typecheck + unit tests + build on every push.

## A. Your rule: "no confirmation until the full amount is received" — implemented
| Where | Behaviour |
|---|---|
| Create booking (dashboard, website API, OTA entry) | Confirmed **only if paid ≥ total**; otherwise `pending` |
| Recording payment | Auto-confirms when the balance hits zero; rejects over-payment; rejected on cancelled/completed bookings |
| No manual "Confirm" button | Removed — the only path to *confirmed* is full payment |
| Confirmation email | Blocked while pending (server-side, not just hidden) |
| Check-in / check-out / no-show | Only from confirmed (check-out also from checked-in) |
| Unpaid holds | Released automatically after *N* hours (Settings → hold hours; default 24); **part-paid holds are never auto-cancelled** — a human decides |
| Website API | Claimed payment is believed **only with a payment reference**; website must verify its gateway callback |
| Reports | Revenue counts only confirmed/in-house/completed; "awaiting payment" is its own attention item |

## B. Defects found & fixed
| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | High | **Aadhaar number was placed in the redirect URL** when revealed (browser history, logs) | Returned only in the POST response via a client component; never in a URL |
| 2 | High | Refund override accepted any % (e.g. 500% → pays 5× what was received) | Clamped/validated 0–100 server-side |
| 3 | High | A repeat booking with the consent box unticked **silently withdrew** marketing/WhatsApp consent | Bookings can only grant consent, never withdraw |
| 4 | High | A new booking using an existing guest's phone **renamed** that guest | Existing names are never overwritten |
| 5 | High | Guest data export returned `{}` (un-awaited promise after the DB went async) | Awaited; covered by e2e |
| 6 | High | "Today" used UTC → wrong between 00:00–05:30 IST (holds, refund tiers, "arrivals") | Property timezone (default Asia/Kolkata) |
| 7 | High | Aadhaar retention date was open-ended for no-shows/cancellations | Delete date = last live stay + retention days; recalculated on cancel/no-show/check-out |
| 8 | Med | Campaign could be sent twice (double-click / two tabs) | Atomically claimed (`approved → sending`) before sending |
| 9 | Med | Loyalty points redeemed on a booking were **lost** if it was cancelled | Points returned on cancel |
| 10 | Med | Points earned on GST-inclusive total | Earned on pre-GST amount |
| 11 | Med | Cancelling a checked-in/no-show booking was allowed | Only pending/confirmed can be cancelled |
| 12 | Med | Check-out allowed on an unpaid (pending) booking | Blocked |
| 13 | Med | Welcome bonus granted even if the booking then failed | Granted only after the booking is saved |
| 14 | Med | Manual calendar blocks beyond the 28-day grid couldn't be removed (not listed) | Lists all upcoming blocks |
| 15 | Med | Success/error messages never shown on Guests and Bookings pages | Flash added |
| 16 | Med | Settings accepted any value (NaN hold hours, GST mode, >100% refund tiers) | Validated; invalid input is rejected with the field named |
| 17 | Med | Occupancy and "balance due" counted unpaid holds as occupied | Occupancy counts confirmed/in-house only |
| 18 | Med | "Collected" ignored refunds and dropped retained cancellation money | Net of refunds |
| 19 | Med | One-click unsubscribe header pointed at a page needing a click (mail clients POST) | Real RFC-8058 POST endpoint |
| 20 | Low | Erasure left free-text booking notes | Notes cleared |
| 21 | Low | Public API: past dates, no rate limit, unbounded stay length | Validated; 429 limiter; 60-night cap |
| 22 | Low | Booking with 0 adults accepted | Rejected |
| 23 | Low | Rates looked up per night (30 DB calls for a 30-night quote) | One lookup per quote |
| 24 | Low | KPI window and iCal used UTC `date('now')` | Property-timezone date passed in |

## C. Known limitations (not defects, but you should know)
- Coupon `max_uses` can be exceeded by perfectly simultaneous bookings (no cross-statement transaction on D1).
- Rate limits are in-memory per instance; use Cloudflare WAF rules for hard limits.
- Refund payouts are **simulated** until RazorpayX credentials are set; the live adapter is unverified against a real account.
- IMAP/SMTP don't run on Cloudflare Workers (use Resend + Email Routing webhook).
- Booking state changes are not yet written to `audit_log` for website-created bookings beyond the creation event.
