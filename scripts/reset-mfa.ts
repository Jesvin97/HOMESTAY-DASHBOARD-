// Recovery for a locked-out OWNER (lost phone AND backup codes). Needs shell access to the server / D1 credentials, so it is not exposed in the web UI.
// Usage: npm run mfa:reset -- owner@example.com
import { db } from "../src/lib/db";
const email = (process.argv[2] || "").toLowerCase();
if (!email) { console.error("Usage: npm run mfa:reset -- <email>"); process.exit(1); }
(async () => {
  const u = await db.prepare("SELECT id FROM users WHERE email=?").get<{ id: number }>(email);
  if (!u) { console.error("No such user"); process.exit(1); }
  await db.prepare("UPDATE users SET totp_secret_enc=NULL, totp_enabled=0, backup_codes=NULL, last_totp_step=0 WHERE id=?").run(u.id);
  await db.prepare("UPDATE sessions SET revoked=1 WHERE user_id=?").run(u.id);
  await db.prepare("INSERT INTO audit_log(user_email,action,entity,entity_id,detail) VALUES (?,?,?,?,?)").run(email, "mfa_reset_cli", "user", String(u.id), "reset from command line");
  console.log("MFA reset. They must set up an authenticator again at next sign-in.");
})();
