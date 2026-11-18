import Link from "next/link";
import NavPicker from "@/components/NavPicker";
import TextSizePicker from "@/components/TextSizePicker";
import TopNav from "@/components/TopNav";
import { MAX_NAV } from "@/lib/nav";
import { readSettings } from "@/lib/settings";

export const metadata = { title: "Sections — Scanmana" };
export const dynamic = "force-dynamic";

/**
 * /sections — the gear (1.6.6). Every section of the app in the order of
 * Kullamägi's routine, with a tick for the ones the top bar carries (six at
 * most) and a tap through to each. The picks and the text size are kept on the account (2.0.3), so every device signed in with it shows the same.
 */
export default async function SectionsPage() {
  const { nav: picks, text } = await readSettings();
  return (
    <main className="mx-auto w-full max-w-xl px-4 lg:max-w-3xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[calc(env(safe-area-inset-bottom)+80px)] lg:pb-6">
      <TopNav current="/sections" subtitle="Sections" />
      <p className="text-[13px] leading-relaxed text-neutral-300">
        Every section, ranked by how often Kullamägi&apos;s routine has you open it. Tick the {MAX_NAV} the top bar should carry — the bar
        draws them in this order, so the first thing you need each evening is the first icon — and tap a row to open it. The gear is always
        there, so nothing you untick is ever more than two taps away. Saved to your account, so every device you sign in on shows the same bar; the home deck&apos;s bottom bar carries your first four picks too.
        Terms in <Link href="/help#sections" className="text-neutral-100 underline underline-offset-4">Help</Link>.
      </p>
      <div className="mt-4">
        <TextSizePicker initial={text} />
      </div>
      <div className="mt-4">
        <NavPicker initial={picks} />
      </div>
    </main>
  );
}
