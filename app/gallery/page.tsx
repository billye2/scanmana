import Link from "next/link";
import GalleryChart from "@/components/GalleryChart";
import TopNav from "@/components/TopNav";
import { addDays, etToday } from "@/lib/dates";
import { galleryBox, galleryFacts, galleryMarkers, gallerySentence, gallerySummary, gallerySummaryText, galleryWindow } from "@/lib/gallery";
import { getGallery } from "@/lib/research";
import { loadBarWindows } from "@/lib/scan";
import type { Bar } from "@/lib/types";

export const metadata = { title: "Best setups — Scanmana" };
export const dynamic = "force-dynamic";

// A scan night is scored only twenty sessions (≈ four weeks) later, so a 30-day
// window would hold a single night; 60 days is about a month of scored nights.
const PERIODS = [
  { key: "60", label: "60 days" },
  { key: "180", label: "180 days" },
  { key: "all", label: "All" },
] as const;
type Period = (typeof PERIODS)[number]["key"];
const DEFAULT_PERIOD: Period = "60";
const LIMIT = 12;

/**
 * /gallery — Kullamägi's monthly review of the charts that worked, from the
 * scanner's own history (1.6.4): the deck rows with the best close in the twenty
 * sessions after their scan night, one per ticker, each drawn with the move into
 * the box, the scan night and the Auto book's buy marked, and the follow-through.
 * Reads scan_history × research_outcomes × bars; writes nothing. No nav icon —
 * linked from /research and Help.
 */
export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const p = (await searchParams).p;
  const period: Period = p === "180" || p === "all" ? p : DEFAULT_PERIOD;
  const since = period === "all" ? null : addDays(etToday(), -Number(period));

  let rows: Awaited<ReturnType<typeof getGallery>> = [];
  let bars = new Map<string, Bar[]>();
  let error: string | null = null;
  try {
    rows = await getGallery(since, LIMIT);
    bars = await loadBarWindows(rows.map((r) => ({ ticker: r.ticker, ...galleryWindow(r.date) })));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const summary = gallerySummary(rows);

  return (
    <main className="mx-auto w-full max-w-xl px-4 lg:max-w-5xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav current="/research" subtitle="Best setups" />

      <p className="text-[13px] leading-relaxed text-neutral-300">
        The deck cards that went furthest in the twenty sessions after their scan night — his monthly review of the charts that
        worked, on the scanner&apos;s own picks. Each chart shows the move into the box, the scan night and the Auto book&apos;s buy
        marked under the bars, and what followed. One card per name. Terms in{" "}
        <Link href="/help#gallery" className="text-neutral-100 underline underline-offset-4">Help</Link>.
      </p>

      <div className="mt-4 flex items-center gap-2" role="tablist" aria-label="Scan nights from">
        {PERIODS.map((x) => (
          <Link
            key={x.key}
            href={x.key === DEFAULT_PERIOD ? "/gallery" : `/gallery?p=${x.key}`}
            role="tab"
            aria-selected={x.key === period}
            className={`rounded-full px-3 py-1 text-xs ${x.key === period ? "bg-neutral-100 font-semibold text-neutral-900" : "bg-neutral-900 text-neutral-400 active:bg-neutral-800"}`}
          >
            {x.label}
          </Link>
        ))}
        <span className="ml-auto text-[11px] text-neutral-500">scan nights with 20 sessions of follow-through</span>
      </div>

      {error && <div className="mt-4 rounded-xl bg-red-950/60 px-3 py-2 text-xs text-red-300">{error}</div>}

      {!error && rows.length === 0 && (
        <div className="mt-4 rounded-xl bg-neutral-900 px-3 py-3 text-[12px] leading-relaxed text-neutral-400">
          Nothing to show for this period yet: a scan night joins the gallery once twenty sessions have passed and the nightly
          outcomes job has scored it. Try a longer period.
        </div>
      )}

      {summary && (
        <div className="mt-4 rounded-xl bg-neutral-900 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">What they had in common on scan night</div>
          <p className="mt-0.5 text-xs leading-snug text-neutral-200">{gallerySummaryText(summary)}</p>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {rows.map((r, i) => {
          const b = bars.get(r.ticker) ?? [];
          return (
            <section key={`${r.ticker}-${r.date}`} className="rounded-xl bg-neutral-900 p-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] text-neutral-500">#{i + 1}</span>
                <Link href={`/s/${r.ticker}`} className="text-base font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">
                  {r.ticker}
                </Link>
                <span className="font-mono text-[11px] text-neutral-500">{r.date}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.verdict === "wait" ? "bg-emerald-950 text-emerald-300" : "bg-neutral-800 text-neutral-400"}`}
                >
                  {r.verdict}
                </span>
                <span className="ml-auto font-mono text-sm tabular-nums text-emerald-300">+{Math.round(r.mfe20 * 100)}%</span>
              </div>
              {b.length > 0 ? (
                <GalleryChart bars={b} box={galleryBox(r)} pivot={r.pivot} markers={galleryMarkers(r, b)} />
              ) : (
                <div className="mt-2 rounded-lg bg-neutral-950 px-3 py-6 text-center text-xs text-neutral-500">bars pruned</div>
              )}
              <p className="mt-2 text-xs leading-snug text-neutral-200">{gallerySentence(r)}</p>
              <p className="mt-1 text-[11px] leading-snug text-neutral-500">{galleryFacts(r)}</p>
            </section>
          );
        })}
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-neutral-600">
        Ranked by the best close in the twenty sessions after the scan night over that night&apos;s close (<span className="font-mono">mfe_20</span>{" "}
        in the outcomes table), one card per ticker. Bars older than the retention window are pruned, so the oldest charts can go blank.
        Back to <Link href="/research" className="text-neutral-400 underline underline-offset-4">Research</Link>.
      </p>
    </main>
  );
}
