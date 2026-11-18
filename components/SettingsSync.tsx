"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Keeps an open page on the account's settings (2.0.3). The bar's picks and
 * the text size are stored per account, so a change made on the phone has to
 * reach a desktop tab that is already open: when the page comes back to the
 * foreground it asks for the settings' signature and redraws only if it differs
 * from the one this page was rendered with. Draws nothing.
 */
export default function SettingsSync({ sig }: { sig: string }) {
  const router = useRouter();
  const rendered = useRef(sig);
  const busy = useRef(false);

  useEffect(() => {
    rendered.current = sig;
  }, [sig]);

  useEffect(() => {
    async function check() {
      if (document.visibilityState !== "visible" || busy.current) return;
      busy.current = true;
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { sig?: string };
        if (typeof body.sig === "string" && body.sig !== rendered.current) {
          rendered.current = body.sig;
          router.refresh();
        }
      } catch {
        // Offline or signed out: the next foreground return tries again.
      } finally {
        busy.current = false;
      }
    }
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", check);
    };
  }, [router]);

  return null;
}
