"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { ChartLine, ChartMarker } from "@/components/Chart";
import GalleryChart from "@/components/GalleryChart";
import { StarIcon } from "@/components/Icons";
import { appCall, blindBars, drillGrade, drillOutcome, drillScoreText, drillVerdictText, type DrillCall, type DrillScore } from "@/lib/drill";
import { galleryBox, galleryFacts, galleryMarkers, gallerySentence, isFiveStar, type GalleryRow } from "@/lib/gallery";
import { inStopDrill, stopChoices, stopOutcomeText, stopVerdictText, STOP_LABEL, type StopDrill, type StopKey } from "@/lib/drill-stop";
import type { Bar } from "@/lib/types";

const NO_MARKERS: readonly ChartMarker[] = [];
const NO_LINES: readonly ChartLine[] = [];
const money = (x: number) => `$${x.toFixed(2)}`;
const rText = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}R`;

/**
 * One drill chart (1.8.5). Covered: the bars up to the scan night, no box, no name,
 * no date, the scan-night facts, and two buttons. Uncovered: the whole window with
 * the box and the markers the gallery draws, who it was, what the app said that
 * night, how the call went, and the running score from the POST's reply. The page
 * keys this component by row, so a refresh with a new row starts covered again.
 *
 * Since 1.9.2 a Take on a boxed card asks a second question before anything is
 * stored: where does the stop go. Four levels (lib/drill-stop.ts); tapping one
 * that has a price tonight draws it on the covered chart, "Set this stop" sends
 * the call. The server grades all four on the same trade and the answer shows
 * them side by side.
 */
export default function DrillCard({ row, bars, initialScore }: { row: GalleryRow; bars: Bar[]; initialScore: DrillScore }) {
  const router = useRouter();
  const [call, setCall] = useState<DrillCall | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [score, setScore] = useState(initialScore);
  const [resetStep, setResetStep] = useState<0 | 1>(0);
  const [showSetup, setShowSetup] = useState(false);
  const [asking, setAsking] = useState(false);
  const [pick, setPick] = useState<StopKey | null>(null);
  const [chosen, setChosen] = useState<StopKey | null>(null);
  const [stops, setStops] = useState<StopDrill | null>(null);
  const [pending, startTransition] = useTransition();

  const covered = useMemo(() => blindBars(bars, row.date), [bars, row.date]);
  const box = useMemo(() => galleryBox(row), [row]);
  const markers = useMemo(() => galleryMarkers(row, bars), [row, bars]);
  const choices = useMemo(() => stopChoices(row, covered), [row, covered]);
  const pickLine = useMemo<readonly ChartLine[]>(() => {
    const c = choices.find((x) => x.key === pick);
    return c && c.price !== null ? [{ price: c.price, color: "#f87171", title: "stop", style: "dashed" }] : NO_LINES;
  }, [choices, pick]);
  const answerLines = useMemo<readonly ChartLine[]>(() => {
    const mine = stops?.results.find((x) => x.key === chosen);
    if (!stops?.filled || stops.entry === null) return NO_LINES;
    const out: ChartLine[] = [{ price: stops.entry, color: "#a3a3a3", title: "entry", style: "dotted" }];
    if (mine && mine.stop !== null && mine.usable) out.push({ price: mine.stop, color: "#f87171", title: "your stop", style: "dashed" });
    return out;
  }, [stops, chosen]);

  function take() {
    if (inStopDrill(row) && bars.length > 0) setAsking(true);
    else void answer("take");
  }

  async function answer(c: DrillCall, stop?: StopKey) {
    if (busy || call) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: row.date, ticker: row.ticker, call: c, ...(stop ? { stop } : {}) }),
      });
      const data = (await res.json()) as { score?: DrillScore; stops?: StopDrill | null; error?: string };
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      if (data.score) setScore(data.score);
      if (stop) {
        setChosen(stop);
        setStops(data.stops ?? null);
      }
      setAsking(false);
      setCall(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  function next() {
    startTransition(() => router.refresh());
  }

  async function startOver() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/drill", { method: "DELETE" });
      if (!res.ok) {
        setErr(((await res.json()) as { error?: string }).error ?? res.statusText);
        return;
      }
      setResetStep(0);
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  const revealed = call !== null;
  const outcome = drillOutcome(row);
  const grade = revealed ? drillGrade(call, outcome) : null;
  const app = appCall(row);

  return (
    <>
      <div className="mt-4 rounded-xl bg-neutral-900 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">Your record</div>
        <p className="mt-0.5 text-xs leading-snug text-neutral-200">{drillScoreText(score)}</p>
      </div>

      <section className="mt-4 rounded-xl bg-neutral-900 p-3">
        {revealed ? (
          <div className="flex flex-wrap items-baseline gap-2">
            {isFiveStar(row) && (
              <span className="flex text-emerald-400" title="5-star: boxed Wait, resting under the box top on scan night" aria-label="5-star setup">
                <StarIcon size={13} fill="currentColor" />
              </span>
            )}
            <Link href={`/s/${row.ticker}`} className="text-base font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">
              {row.ticker}
            </Link>
            <span className="font-mono text-[11px] text-neutral-500">{row.date}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${row.verdict === "wait" ? "bg-emerald-950 text-emerald-300" : "bg-neutral-800 text-neutral-400"}`}
            >
              {row.verdict}
            </span>
            <span className={`ml-auto font-mono text-sm tabular-nums ${row.mfe20 >= 0 ? "text-emerald-300" : "text-red-300"}`}>
              {row.mfe20 >= 0 ? "+" : "−"}
              {Math.round(Math.abs(row.mfe20) * 100)}%
            </span>
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold text-neutral-100">A deck card, right side covered</span>
            <span className="ml-auto text-[11px] text-neutral-500">name and night hidden</span>
          </div>
        )}

        {bars.length > 0 ? (
          <GalleryChart
            bars={revealed ? bars : covered}
            box={revealed ? box : null}
            pivot={revealed ? row.pivot : null}
            markers={revealed ? markers : NO_MARKERS}
            lines={revealed ? answerLines : pickLine}
          />
        ) : (
          <div className="mt-2 rounded-lg bg-neutral-950 px-3 py-6 text-center text-xs text-neutral-500">bars pruned</div>
        )}

        {revealed && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowSetup((v) => !v)}
              aria-expanded={showSetup}
              className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-300 active:bg-neutral-700"
            >
              {showSetup ? "Hide setup" : "Review setup"}
            </button>
            {showSetup && (
              <div className="mt-2 rounded-lg bg-neutral-950/60 p-2">
                <div className="text-[11px] text-neutral-500">The chart as you saw it, right side covered</div>
                <GalleryChart bars={covered} box={null} pivot={null} markers={NO_MARKERS} />
              </div>
            )}
          </div>
        )}

        <p className="mt-2 text-[11px] leading-snug text-neutral-500">{galleryFacts(row)}</p>

        {!revealed && asking && (
          <>
            <p className="mt-3 text-[13px] leading-relaxed text-neutral-200">
              You are taking it: the buy is the open after its first close above the box. Where does the stop go? Tap a level to see it on
              the chart, then set it.
            </p>
            <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Stop level">
              {choices.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={pick === c.key}
                  onClick={() => setPick(c.key)}
                  disabled={busy}
                  className={`rounded-xl px-3 py-2 text-left disabled:opacity-40 ${pick === c.key ? "bg-neutral-800 ring-1 ring-inset ring-red-400/70" : "bg-neutral-950/60 active:bg-neutral-800"}`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-neutral-100">{c.label}</span>
                    <span className="ml-auto font-mono text-xs tabular-nums text-neutral-300">
                      {c.price !== null ? money(c.price) : c.under !== null ? `${(c.under * 100).toFixed(1)}% under the fill` : "set at the breakout"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-neutral-500">
                    {c.note}
                    {c.price !== null && c.under !== null ? ` ${(c.under * 100).toFixed(1)}% under the box top.` : ""}
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-[2fr_1fr] gap-2">
              <button
                type="button"
                onClick={() => pick && answer("take", pick)}
                disabled={busy || !pick}
                className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-neutral-950 active:bg-emerald-300 disabled:opacity-40"
              >
                Set this stop
              </button>
              <button
                type="button"
                onClick={() => {
                  setAsking(false);
                  setPick(null);
                }}
                disabled={busy}
                className="rounded-xl bg-neutral-800 px-4 py-3 text-sm font-semibold text-neutral-200 active:bg-neutral-700 disabled:opacity-40"
              >
                Back
              </button>
            </div>
          </>
        )}

        {!revealed && !asking && (
          <>
            <p className="mt-3 text-[13px] leading-relaxed text-neutral-200">
              The scan picked this card tonight. Would you place the order — a leader that has made its move and is resting tight, or not
              the one?
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={take}
                disabled={busy}
                className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-neutral-950 active:bg-emerald-300 disabled:opacity-40"
              >
                Take
              </button>
              <button
                type="button"
                onClick={() => answer("skip")}
                disabled={busy}
                className="rounded-xl bg-neutral-800 px-4 py-3 text-sm font-semibold text-neutral-200 active:bg-neutral-700 disabled:opacity-40"
              >
                Skip
              </button>
            </div>
          </>
        )}

        {revealed && (
          <>
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                grade === "right" ? "bg-emerald-950/70 text-emerald-200" : grade === "wrong" ? "bg-red-950/60 text-red-200" : "bg-neutral-800 text-neutral-300"
              }`}
            >
              {drillVerdictText(call, row)}
            </p>
            <p className="mt-2 text-xs leading-snug text-neutral-200">{gallerySentence(row)}</p>
            {stops && chosen && (
              <div className="mt-3 rounded-lg bg-neutral-950/60 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-red-300">Your stop</div>
                <p className="mt-0.5 text-xs leading-snug text-neutral-200">{stopVerdictText(stops, chosen)}</p>
                {stops.filled && (
                  <>
                    <table className="mt-2 w-full text-[11px]">
                      <tbody>
                        {stops.results.map((s) => (
                          <tr key={s.key} className={`border-t border-neutral-800 ${s.key === chosen ? "text-neutral-100" : "text-neutral-400"}`}>
                            <td className="py-1 pr-2">
                              {STOP_LABEL[s.key]}
                              {s.key === chosen ? <span className="text-red-300"> · yours</span> : null}
                            </td>
                            <td className="py-1 pr-2 text-right font-mono tabular-nums">{s.usable && s.risk !== null ? `${(s.risk * 100).toFixed(1)}%` : "—"}</td>
                            <td className="py-1 pr-2">{stopOutcomeText(s)}</td>
                            <td className={`py-1 text-right font-mono tabular-nums ${s.r === null ? "" : s.r >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                              {s.r === null ? "—" : rText(s.r)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-[11px] leading-snug text-neutral-500">
                      One trade, four stops: bought at {stops.entry !== null ? money(stops.entry) : "the open"} on {stops.entryDate}, sold by the Auto
                      book&apos;s routine over {stops.days} session{stops.days === 1 ? "" : "s"}. The percentage is the risk under the fill. A wider
                      stop survives more and makes fewer R on the same move.
                    </p>
                  </>
                )}
              </div>
            )}
            <p className="mt-1 text-[11px] leading-snug text-neutral-500">
              The app that night: {row.verdict === "wait" ? "Wait" : "Pass"}
              {row.boxed ? ", boxed" : ", no box"}
              {isFiveStar(row) ? ", its 5-star candidate" : ", not a 5-star candidate"} · the 5-star rule would {app === "take" ? "take" : "skip"} it
              {app === call ? " — same call as yours" : " — the other call"}.
            </p>
            <button
              type="button"
              onClick={next}
              disabled={pending}
              className="mt-3 w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-semibold text-neutral-900 active:bg-neutral-300 disabled:opacity-60"
            >
              {pending ? "Drawing the next chart…" : "Next chart"}
            </button>
          </>
        )}

        {err && <div className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">{err}</div>}
      </section>

      <div className="mt-6 text-[11px] leading-relaxed text-neutral-600">
        {resetStep === 0 ? (
          <button type="button" onClick={() => setResetStep(1)} className="underline underline-offset-4 active:text-neutral-400">
            Start over
          </button>
        ) : (
          <span>
            Forget your {score.n} call{score.n === 1 ? "" : "s"}?{" "}
            <button type="button" onClick={startOver} disabled={busy} className="font-semibold text-red-300 underline underline-offset-4 disabled:opacity-40">
              Yes, forget them
            </button>{" "}
            ·{" "}
            <button type="button" onClick={() => setResetStep(0)} className="underline underline-offset-4">
              Keep
            </button>
          </span>
        )}
      </div>
    </>
  );
}
