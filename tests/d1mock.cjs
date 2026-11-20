// Tiny stand-in for Cloudflare's D1 REST endpoint (POST .../d1/database/:id/query), backed by SQLite. Test-only.
const http = require("http"); const Database = require("better-sqlite3");
const db = new Database(":memory:"); db.pragma("foreign_keys = ON");
const one = (sql, params = []) => {
  const st = db.prepare(sql);
  if (st.reader) return { results: st.all(...params), success: true, meta: { changes: 0, last_row_id: 0 } };
  const r = st.run(...params); return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
};
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    if (req.headers.authorization !== "Bearer test-token") { res.writeHead(403); return res.end(JSON.stringify({ success: false, errors: [{ message: "bad token" }] })); }
    try {
      const j = JSON.parse(b); let result;
      if (j.batch) result = db.transaction(() => j.batch.map((s) => one(s.sql, s.params)))();
      else if (/;\s*\S/.test(j.sql.trim().replace(/;$/, ""))) { db.exec(j.sql); result = [{ results: [], success: true, meta: {} }]; }
      else result = [one(j.sql, j.params)];
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ success: true, errors: [], result }));
    } catch (e) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ success: false, errors: [{ message: String(e.message) }] })); }
  });
}).listen(8799, () => console.log("d1 mock on 8799"));
