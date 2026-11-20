import { migrate, usingD1 } from "../src/lib/db";
migrate().then(() => console.log(`Schema applied to ${usingD1 ? "Cloudflare D1" : "local SQLite"} (CREATE TABLE IF NOT EXISTS — existing tables are left untouched).`)).catch((e) => { console.error(e); process.exit(1); });
