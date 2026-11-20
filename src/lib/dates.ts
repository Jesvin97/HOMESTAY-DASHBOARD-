export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => iso(new Date());
export function addDays(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
export function nightsBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
export function eachNight(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d < b; d = addDays(d, 1)) out.push(d);
  return out;
}
export const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const fmtDate = (s?: string | null) =>
  s ? new Date(s.length === 10 ? s + "T00:00:00Z" : s.replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
