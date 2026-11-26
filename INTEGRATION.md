# Website ↔ dashboard integration

The **dashboard is the single source of truth**: rooms, prices, availability, bookings, payments, refunds, callback requests.
The website never touches the database. It calls the dashboard's signed API from its **server** (never from the browser).

## Set up
1. Dashboard `.env`: `WEBSITE_API_SECRET` (≥32 chars), and for refunds `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV`.
2. Create/upgrade tables: `npm run db:migrate` (adds the new columns safely; works on local SQLite and Cloudflare D1).
3. Load the website's rooms, add-ons, coupons and matching settings: `npm run seed:catalog` (safe to repeat; never overwrites the owner's edits).
4. Website `.env.local`: `DASHBOARD_API_URL` (e.g. `http://localhost:3002`) and the same `DASHBOARD_API_SECRET`.

## Signing every request
Headers: `x-timestamp` (seconds), `x-nonce` (16-64 chars, never reused), `x-signature` =
`hex( HMAC-SHA256( secret, timestamp \n nonce \n METHOD \n path+query \n sha256hex(body) ) )`.
Rejected if the signature is wrong, the request is older than 5 minutes, or the nonce was seen before. `GET` has an empty body.

## Endpoints (all under `/api/public`)
| Method & path | Purpose |
|---|---|
| `GET /availability?checkIn&checkOut&adults&children&plan&services&coupon` | Every room: `available`, reason, price |
| `POST /quote` | Price for one room (add-ons by code, coupon, plan) |
| `GET /booked?room=slug` | Date ranges already taken for a room |
| `POST /holds` | Hold the dates for a guest about to pay (409 if taken); returns `code`, `total`, `expiresAt` |
| `POST /holds/{code}/order` `{orderId}` | Remember the Cashfree order for the hold |
| `POST /holds/{code}/release` | Payment could not start: give the dates back |
| `POST /bookings/{code}/payment` `{orderId,paymentId,amount}` | A payment the website VERIFIED with Cashfree. Confirms if amount = total and dates are free; otherwise full automatic refund |
| `GET /bookings/{code}` | Public summary (first name, last 4 phone digits) |
| `POST /cancel/lookup` `{code,phone}` | The booking and today's refund |
| `POST /cancel` `{code,phone}` | Cancel and refund per policy (once only) |
| `POST /leads` | "Request a callback" |

## Rules enforced here (the website can't override them)
* Prices are always recalculated here. Past check-in dates are refused; **today is allowed** (same-day booking).
* Dates are taken in one atomic database step: no two bookings overlap; the **whole house clashes with every room**.
* An unpaid website hold lapses after *Settings → website hold minutes* (default 25). The Cashfree order should expire sooner (16 min).
* Refund % = policy by days before check-in (default 16+ days 75%, 3-15 days 50%, last 3 days 0%), edited in Settings. Refund goes to the original payment method through Cashfree; a cancellation can only be refunded once.
* If a guest pays after another guest took the dates, they are refunded in full automatically.
