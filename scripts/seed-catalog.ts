/** Loads the website's rooms, add-ons and coupons (and matching tax/booking settings). Safe to run more than once. */
import { seedWebsiteCatalog } from "../src/lib/catalog";
seedWebsiteCatalog().then(() => console.log("Website catalog loaded: 4 rooms, 4 add-ons, 3 coupons, GST/hold/refund settings.")).catch((e) => { console.error(e); process.exit(1); });
