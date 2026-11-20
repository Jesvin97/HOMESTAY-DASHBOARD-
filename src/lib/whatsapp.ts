/**
 * Testimonial requests over WhatsApp.
 * We deliberately do NOT automate WhatsApp Web (scripted sending violates WhatsApp's ToS and gets numbers banned).
 * Instead we generate click-to-chat links with a pre-filled message: a human taps Send. Only guests who gave WhatsApp consent are queued.
 * For fully automatic sending, use the WhatsApp Business Cloud API with an approved template.
 */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 12 && d.startsWith("91")) return d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
export function testimonialLink(phone: string, guestName: string, property: string, reviewUrl: string) {
  const n = normalizePhone(phone);
  if (!n) return null;
  const msg = `Hi ${guestName.split(" ")[0]}, thank you for staying at ${property}! 🌿 We'd love a few words about your stay — it takes a minute: ${reviewUrl}\n(Reply STOP to opt out.)`;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
}
