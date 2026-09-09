"use client";

import { useEffect, useState } from "react";

/**
 * Poll a live endpoint every `intervalMs` while the tab is visible, and again the
 * moment it becomes visible (so coming back to the app never waits a full tick).
 * Pass `null` to disable. The server's shared quote cache paces Finnhub, not this.
 */
export function useLive<T>(url: string | null, intervalMs = 60_000): { data: T | null; err: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let last = 0;
    const load = () => {
      last = Date.now();
      fetch(url)
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? r.statusText))))
        .then((j) => { if (alive) { setData(j); setErr(null); } })
        .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    };
    load();
    const tick = () => document.visibilityState === "visible" && load();
    const t = setInterval(tick, intervalMs);
    // Back from the background: refresh now unless the last load was moments ago.
    const onVisible = () => document.visibilityState === "visible" && Date.now() - last > 10_000 && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, intervalMs]);

  return { data, err };
}
