"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
}

type State = "unsupported" | "needs-install" | "ready" | "subscribed" | "denied";

function describe(err: unknown): string {
  const e = err as { name?: string; message?: string };
  return [e?.name, e?.message].filter(Boolean).join(": ") || String(err);
}

/**
 * The "Enable nightly scan alerts" control under the deck. Every step reports
 * on screen — permission prompt, subscribe, server save — because iOS gives
 * no other feedback, and a subscribed device gets a "Send test alert" button
 * so the setup can be verified without waiting for the midnight scan.
 */
export default function PushSetup() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator)) return setState("unsupported");
      const reg = await navigator.serviceWorker.register("/sw.js");

      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (isIOS && !standalone) return setState("needs-install");
      if (!("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");

      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "subscribed" : "ready");
    })().catch((err) => {
      setState("unsupported");
      setNote({ tone: "err", text: `Alerts unavailable: ${describe(err)}` });
    });
  }, []);

  async function enable() {
    setNote(null);
    setBusy(true);
    try {
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not in this build");
      // Must be the first await after the tap: iOS only shows the prompt inside a user gesture.
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
        }));
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error(`server said ${res.status} saving the subscription`);
      setState("subscribed");
      setNote({ tone: "ok", text: "Alerts on for this device. Tap Send test alert to see one now." });
    } catch (err) {
      setNote({ tone: "err", text: `Could not enable alerts — ${describe(err)}` });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setNote(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setState("ready");
        throw new Error("this device is no longer subscribed — enable alerts again");
      }
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || `server said ${res.status}`);
      setNote({ tone: "ok", text: "Test alert sent. It should appear within a few seconds." });
    } catch (err) {
      setNote({ tone: "err", text: `Test failed — ${describe(err)}` });
    } finally {
      setBusy(false);
    }
  }

  const noteEl = note && (
    <p className={`text-xs ${note.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`} role="status">
      {note.text}
    </p>
  );

  if (state === "needs-install") {
    return (
      <div className="mb-3 rounded-xl bg-sky-950/60 px-3 py-2 text-xs text-sky-200">
        To get nightly alerts on iPhone: tap <span className="font-semibold">Share</span> →{" "}
        <span className="font-semibold">Add to Home Screen</span>, then open Scanmana from there.
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="mb-3 rounded-xl bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
        Notifications are off for Scanmana. Turn them on in Settings → Notifications → Scanmana, then reopen the app.
      </div>
    );
  }
  if (state === "ready") {
    return (
      <div className="mb-3 flex flex-col gap-1.5">
        <button
          onClick={enable}
          disabled={busy}
          className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white active:bg-emerald-500 disabled:opacity-60"
        >
          {busy ? "Enabling…" : "Enable nightly scan alerts"}
        </button>
        {noteEl}
      </div>
    );
  }
  if (state === "subscribed") {
    return (
      <div className="mb-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-xs text-neutral-500">
          <span>Nightly scan alerts are on for this device.</span>
          <button
            onClick={test}
            disabled={busy}
            className="shrink-0 rounded-lg bg-neutral-800 px-2.5 py-1 font-medium text-neutral-300 active:bg-neutral-700 disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send test alert"}
          </button>
        </div>
        {noteEl}
      </div>
    );
  }
  return noteEl ? <div className="mb-3">{noteEl}</div> : null;
}
