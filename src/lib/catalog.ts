import { db, setSetting } from "./db";

/**
 * The rooms, add-ons and coupons the website sells, loaded into the dashboard so both show the same things.
 * Safe to run again: rooms are matched by slug, add-ons by code, coupons by code (existing prices are NOT overwritten,
 * so the owner's edits in the dashboard stay). Prices here are the website's SAMPLE prices until the owner supplies real ones.
 */
export const WEBSITE_ROOMS = [
  { slug: "heritage-room", name: "Heritage Room", type: "Room", capacity: 4, base_occupancy: 2, base_price: 4500, meals_extra: 1700, blocks_all: 0 },
  { slug: "plantation-cottage", name: "Plantation Cottage", type: "Cottage", capacity: 5, base_occupancy: 2, base_price: 5500, meals_extra: 1900, blocks_all: 0 },
  { slug: "family-suite", name: "Family Suite", type: "Suite", capacity: 6, base_occupancy: 4, base_price: 7800, meals_extra: 2800, blocks_all: 0 },
  { slug: "whole-home", name: "Whole Home", type: "Whole home", capacity: 14, base_occupancy: 8, base_price: 21000, meals_extra: 7000, blocks_all: 1 },
] as const;

export const WEBSITE_SERVICES = [
  { code: "pickup", name: "Airport pickup", price: 1800, unit: "one way" },
  { code: "dinner", name: "Candlelight dinner", price: 2500, unit: "for two" },
  { code: "cooking", name: "Cooking class", price: 1200, unit: "per stay" },
  { code: "spa", name: "Ayurveda massage", price: 2200, unit: "60 min" },
] as const;

export const WEBSITE_COUPONS = [
  { code: "DIRECT10", description: "10% off when you book on our website", type: "percent", value: 10, min_nights: 1 },
  { code: "EARLY30", description: "₹750 off, booked 30+ days ahead", type: "flat", value: 750, min_nights: 2 },
  { code: "STAY5", description: "15% off on stays of 5 nights or more", type: "percent", value: 15, min_nights: 5 },
] as const;

export async function seedWebsiteCatalog() {
  for (const r of WEBSITE_ROOMS) {
    const have = await db.prepare("SELECT id FROM rooms WHERE slug=?").get<{ id: number }>(r.slug);
    if (have) continue;
    await db.prepare("INSERT INTO rooms(slug,name,type,capacity,base_occupancy,base_price,meals_extra,blocks_all,description,active) VALUES (?,?,?,?,?,?,?,?,?,1)")
      .run(r.slug, r.name, r.type, r.capacity, r.base_occupancy, r.base_price, r.meals_extra, r.blocks_all, "");
  }
  for (const s of WEBSITE_SERVICES) {
    if (await db.prepare("SELECT 1 FROM services WHERE code=?").get(s.code)) continue;
    await db.prepare("INSERT INTO services(code,name,category,price,unit,included,active) VALUES (?,?,'Add-on',?,?,0,1)").run(s.code, s.name, s.price, s.unit);
  }
  for (const c of WEBSITE_COUPONS) {
    if (await db.prepare("SELECT 1 FROM coupons WHERE code=? COLLATE NOCASE").get(c.code)) continue;
    await db.prepare("INSERT INTO coupons(code,description,type,value,min_nights,active) VALUES (?,?,?,?,?,1)").run(c.code, c.description, c.type, c.value, c.min_nights);
  }
  // Tax and booking rules that match what the website showed (flat GST: CONFIRM THE RATE WITH THE ACCOUNTANT).
  for (const [k, v] of Object.entries({ gst_mode: "flat", gst_flat_pct: "5", services_gst_pct: "5", extra_adult_per_night: "1200", web_hold_minutes: "25", auto_refund_online: "1" })) {
    await setSetting(k, v);
  }
}
