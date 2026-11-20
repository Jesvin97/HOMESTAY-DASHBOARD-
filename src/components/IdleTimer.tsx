"use client";
import { useEffect, useRef, useState } from "react";

/** Client-side idle watcher. The server ALSO enforces the timeout, so this is UX only. */
export default function IdleTimer({ idleMs }: { idleMs: number }) {
  const last = useRef(Date.now());
  const lastPing = useRef(Date.now());
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    const act = () => {
      last.current = Date.now();
      if (Date.now() - lastPing.current > 60_000) { lastPing.current = Date.now(); fetch("/api/session/ping", { method: "POST" }).catch(() => {}); }
    };
    const evs = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, act, { passive: true }));
    const iv = setInterval(async () => {
      const idle = Date.now() - last.current;
      setWarn(idle > idleMs - 60_000 && idle <= idleMs);
      if (idle > idleMs) { await fetch("/api/logout", { method: "POST" }).catch(() => {}); window.location.href = "/login?timeout=1"; }
    }, 5000);
    return () => { evs.forEach((e) => window.removeEventListener(e, act)); clearInterval(iv); };
  }, [idleMs]);

  if (!warn) return null;
  return (
    <div role="alertdialog" className="fixed bottom-4 right-4 z-50 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
      You'll be signed out in under a minute due to inactivity. Move your mouse or press a key to stay signed in.
    </div>
  );
}
