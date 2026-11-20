import { db, st } from "./db";

const ymd = (s: string) => s.replace(/-/g, "");
export async function roomIcs(roomId: number): Promise<string> {
  const name = (await db.prepare("SELECT name FROM rooms WHERE id=?").get(roomId) as { name: string } | undefined)?.name ?? "Room";
  const rows = await db.prepare("SELECT code uid,check_in s,check_out e FROM bookings WHERE room_id=? AND status IN ('confirmed','checked_in','pending') AND check_out>=date('now')").all(roomId) as { uid: string; s: string; e: string }[];
  const blocks = await db.prepare("SELECT 'blk'||id uid,start_date s,end_date e FROM room_blocks WHERE room_id=? AND source!='ota' AND end_date>=date('now')").all(roomId) as { uid: string; s: string; e: string }[];
  const ev = [...rows, ...blocks].map((r) => `BEGIN:VEVENT\r\nUID:${r.uid}@homestay\r\nDTSTART;VALUE=DATE:${ymd(r.s)}\r\nDTEND;VALUE=DATE:${ymd(r.e)}\r\nSUMMARY:Reserved\r\nEND:VEVENT`).join("\r\n");
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Homestay Dashboard//${name}//EN\r\n${ev}${ev ? "\r\n" : ""}END:VCALENDAR\r\n`;
}

/** Pull an OTA's iCal feed and mirror it as room blocks, so the website can never double-sell. */
export async function syncChannel(channelId: number): Promise<string> {
  const ch = await db.prepare("SELECT * FROM channels WHERE id=?").get(channelId) as { id: number; room_id: number | null; ical_url: string | null } | undefined;
  if (!ch?.ical_url || !ch.room_id) return "Channel needs a room and an iCal URL.";
  let text: string;
  try {
    const u = new URL(ch.ical_url);
    if (u.protocol !== "https:") throw new Error("https only");
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    text = await r.text();
  } catch (e) {
    const msg = "Sync failed: " + (e as Error).message;
    await db.prepare("UPDATE channels SET last_sync=datetime('now'), last_result=? WHERE id=?").run(msg, ch.id);
    return msg;
  }
  const events = [...text.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].map((m) => ({
    uid: /UID:(.+)/.exec(m[1])?.[1]?.trim(),
    s: /DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/.exec(m[1]),
    e: /DTEND[^:]*:(\d{4})(\d{2})(\d{2})/.exec(m[1]),
  })).filter((x) => x.uid && x.s && x.e);
  await db.batch([
    st("DELETE FROM room_blocks WHERE room_id=? AND source='ota' AND external_uid LIKE ?", ch.room_id, `ch${ch.id}:%`),
    ...events.map((e) => st("INSERT INTO room_blocks(room_id,start_date,end_date,reason,source,external_uid) VALUES (?,?,?,?, 'ota', ?)",
      ch.room_id, `${e.s![1]}-${e.s![2]}-${e.s![3]}`, `${e.e![1]}-${e.e![2]}-${e.e![3]}`, "Channel booking", `ch${ch.id}:${e.uid}`)),
  ]);
  const msg = `Synced ${events.length} blocked period(s).`;
  await db.prepare("UPDATE channels SET last_sync=datetime('now'), last_result=? WHERE id=?").run(msg, ch.id);
  return msg;
}
