import { db, getSetting } from "@/lib/db";
import { markRequestedAction, saveTestimonialAction } from "@/app/actions";
import { testimonialLink } from "@/lib/whatsapp";
import { Card, Field, Flash, PageHeader, Badge, btn, btnGhost, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/dates";

type T = { id: number; status: string; token: string; rating: number | null; text: string | null; publish: number; name: string; phone: string | null; consent_whatsapp: number; check_out: string; code: string };

export default async function Testimonials({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const rows = db.prepare(`SELECT t.id,t.status,t.token,t.rating,t.text,t.publish,g.name,g.phone,g.consent_whatsapp,b.check_out,b.code FROM testimonials t JOIN guests g ON g.id=t.guest_id LEFT JOIN bookings b ON b.id=t.booking_id WHERE g.erased_at IS NULL ORDER BY t.id DESC LIMIT 100`).all() as T[];
  const base = process.env.APP_URL || "http://localhost:3000";
  const prop = getSetting("property_name");
  return (
    <>
      <PageHeader title="Testimonials via WhatsApp" sub="After check-out, guests who agreed to WhatsApp are queued here. You tap Send — it opens WhatsApp with the message ready." />
      <Flash msg={sp.msg} err={sp.err} />
      <p className="mb-4 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
        We don't script WhatsApp Web: automated sending through WhatsApp Web breaks WhatsApp's terms and can get your number banned. This one-tap approach is safe, keeps a human in the loop, and still takes ~5 seconds per guest. For fully automatic sending, connect the official WhatsApp Business Cloud API (needs an approved template).
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((t) => {
          const link = t.consent_whatsapp && t.phone ? testimonialLink(t.phone, t.name, prop, `${base}/review/${t.token}`) : null;
          return (
            <Card key={t.id} title={`${t.name} · ${t.code ?? ""}`} action={<Badge v={t.status} />}>
              <p className="text-xs text-slate-500">Checked out {fmtDate(t.check_out)}</p>
              {t.status === "queued" && (link ? (
                <form action={markRequestedAction} className="mt-2"><input type="hidden" name="id" value={t.id} />
                  <a href={link} target="_blank" rel="noreferrer" className={btn}>Open WhatsApp &amp; send</a> <button className={btnGhost}>I sent it</button></form>
              ) : <p className="mt-2 text-sm text-amber-700">{!t.consent_whatsapp ? "Guest hasn't agreed to WhatsApp contact — not queued for messaging." : "No valid phone number."}</p>)}
              {t.status === "requested" && <p className="mt-2 text-xs text-slate-500">Review link: <code>{base}/review/{t.token}</code></p>}
              {t.status !== "received" ? (
                <form action={saveTestimonialAction} className="mt-3 space-y-2 border-t pt-3"><input type="hidden" name="id" value={t.id} />
                  <p className="text-xs text-slate-500">Guest replied by message? Paste it here:</p>
                  <div className="flex gap-2"><select name="rating" className={inputCls + " w-24"} defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select><input name="text" placeholder="Their words" className={inputCls} /></div>
                  <label className="text-xs"><input type="checkbox" name="publish" /> Guest agreed it can be shown on the website</label> <button className={btnGhost}>Save</button></form>
              ) : <p className="mt-2 text-sm">{"★".repeat(t.rating ?? 0)} “{t.text}” {t.publish ? <Badge v="confirmed" /> : <span className="text-xs text-slate-500">(not for publishing)</span>}</p>}
            </Card>
          );
        })}
      </div>
      {!rows.length && <p className="text-sm text-slate-500">No guests have checked out yet.</p>}
    </>
  );
}
