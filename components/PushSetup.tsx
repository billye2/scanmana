"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
}

type State = "unsupported" | "needs-install" | "ready" | "subscribed" | "denied";

export default function PushSetup() {
  const [state, setState] = useState<State | null>(null);

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
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) return;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setState("denied");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
    });
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    setState("subscribed");
  }

  if (state === "needs-install") {
    return (
      <div className="mb-3 rounded-xl bg-sky-950/60 px-3 py-2 text-xs text-sky-200">
        To get nightly alerts on iPhone: tap <span className="font-semibold">Share</span> →{" "}
        <span className="font-semibold">Add to Home Screen</span>, then open Scanmana from there.
      </div>
    );
  }
  if (state === "ready") {
    return (
      <button
        onClick={enable}
        className="mb-3 w-full rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white active:bg-emerald-500"
      >
        Enable nightly scan alerts
      </button>
    );
  }
  return null;
}
