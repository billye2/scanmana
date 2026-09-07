import { CONFIG } from "./config";
import { money, pct, price as fmt } from "./format";
import { detectEp, sma, smaRising } from "./indicators";
import { readVcp } from "./minervini";
import type { Analysis, Bar, Candidate, FrameworkView, MarketHealth, Verdict } from "./types";

const A = CONFIG.ANALYSIS;

function sessionsSince(bars: Bar[], date: string): number {
  const i = bars.findIndex((b) => b.date >= date);
  return i < 0 ? 0 : bars.length - 1 - i;
}

function worst(...v: Verdict[]): Verdict {
  return v.includes("pass") ? "pass" : "wait";
}

/** Facts every framework looks at, computed once. */
function facts(c: Candidate, market: MarketHealth | undefined) {
  const bars = c.bars;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const s10 = sma(bars, 10)!;
  const s20 = sma(bars, 20)!;
  const s50 = sma(bars, 50);
  const lows21 = bars.slice(-CONFIG.MIN_PRICE_WINDOW).map((b) => b.c);
  const low21 = Math.min(...lows21);
  const spike = detectEp(bars, { ...CONFIG.EP, LOOKBACK: A.SPIKE_LOOKBACK });
  const vol5 = bars.slice(-5).reduce((s, b) => s + b.v, 0) / 5;
  const vol20 = bars.slice(-20).reduce((s, b) => s + b.v, 0) / 20;
  const hi126 = Math.max(...bars.slice(-CONFIG.HIGH_LOOKBACK).map((b) => b.h));
  const hiIdx = bars.slice(-CONFIG.HIGH_LOOKBACK).findLastIndex((b) => b.h === hi126);
  const sinceHigh = bars.slice(-CONFIG.HIGH_LOOKBACK).length - 1 - hiIdx;
  const parabolic = c.adrPct > A.MAX_ADR_PCT || c.ret1m > A.MAX_RET_1M || low21 < CONFIG.MIN_PRICE;
  const restDays = c.box ? sessionsSince(bars, c.box.startDate) : 0;
  const breakingOut = !!c.box && last.c > c.box.top && prev.c <= c.box.top;
  const marketOk = market?.verdict === "bullish";
  return {
    bars, last, prev, s10, s20, s50, low21, spike, vol5, vol20, hi126, sinceHigh,
    parabolic, restDays, breakingOut, marketOk,
    rising10: smaRising(bars, 10, CONFIG.SMA_SLOPE_LOOKBACK),
    rising20: smaRising(bars, 20, CONFIG.SMA_SLOPE_LOOKBACK),
    rising50: s50 !== null && smaRising(bars, 50, CONFIG.SMA_SLOPE_LOOKBACK),
  };
}
type Facts = ReturnType<typeof facts>;

function qullamaggie(c: Candidate, f: Facts, market: MarketHealth | undefined): FrameworkView {
  const p: string[] = [];
  let v: Verdict = "wait";

  // 1. Prior move
  const run = Math.max(c.ret1m, c.ret3m, c.ret6m);
  p.push(`Prior move: ${pct(c.ret1m)} in a month, ${pct(c.ret3m)} in three, ${pct(c.ret6m)} in six — ${run >= 0.3 ? "a real run, the raw material he wants" : "thin; he wants 30–100%+ first"}.`);

  // 2. Parabolic / no base
  if (f.parabolic) {
    const why: string[] = [];
    if (c.adrPct > A.MAX_ADR_PCT) why.push(`ADR ${c.adrPct.toFixed(0)}%/day`);
    if (c.ret1m > A.MAX_RET_1M) why.push(`${pct(c.ret1m)} in 21 sessions`);
    if (f.low21 < CONFIG.MIN_PRICE) why.push(`traded at ${fmt(f.low21)} within the month`);
    p.push(`${why.join(", ")} — this is the vertical leg of a spike, not a swing setup. He does not buy parabolic moves; his only play here is the short side after it cracks.`);
    v = "pass";
  }
  if (f.spike && !f.parabolic) {
    const d = sessionsSince(f.bars, f.spike.date);
    p.push(`Episodic pivot ${f.spike.date} (${pct(f.spike.gapPct)} gap, ${f.spike.volMult.toFixed(0)}× volume), ${d} session${d === 1 ? "" : "s"} ago${d <= 2 ? " — his EP entry is the opening range of the gap day; that window has passed unless it sets up again" : ""}.`);
  }

  // 3. Rest / consolidation
  if (!c.box) {
    p.push(`No consolidation to break out of — ${f.sinceHigh === 0 ? "it closed at a new high today" : `the 6-month high was ${f.sinceHigh} session${f.sinceHigh === 1 ? "" : "s"} ago`} and nothing has capped it. He wants 2–8 weeks of orderly rest first.`);
    v = worst(v, f.parabolic ? "pass" : "wait");
  } else if (f.restDays < A.MIN_REST_DAYS) {
    p.push(`Only ${f.restDays} session${f.restDays === 1 ? "" : "s"} of rest since the box formed; he wants at least two weeks (${A.MIN_REST_DAYS} sessions).`);
    v = worst(v, "wait");
  } else if (f.restDays > A.MAX_REST_DAYS) {
    p.push(`${f.restDays} sessions in the box — longer than his 8-week window; the momentum that set it up is stale.`);
    v = worst(v, "wait");
  } else {
    p.push(`${f.restDays} sessions of consolidation (${(c.box.top / c.box.bottom - 1) * 100 < 10 ? "tight" : "orderly"}, ${pct(c.box.top / c.box.bottom - 1)} tall) — inside his 2–8 week window.`);
  }

  // 4. MA surfing
  const surf = [f.last.c > f.s10, f.last.c > f.s20, f.s50 === null || f.last.c > f.s50];
  const risingAll = f.rising10 && f.rising20 && f.rising50;
  p.push(`Price ${surf[0] ? "above" : "below"} the 10-day, ${surf[1] ? "above" : "below"} the 20-day${f.s50 !== null ? `, ${surf[2] ? "above" : "below"} the 50-day` : ""}; averages ${risingAll ? "all rising — surfing the way he likes" : `${[!f.rising10 && "10", !f.rising20 && "20", !f.rising50 && "50"].filter(Boolean).join("/")}-day not rising`}.`);
  if (!surf[0] || !surf[1] || !risingAll) v = worst(v, "wait");

  // 5. Tightness
  p.push(`Tightness ${c.tightness.toFixed(2)} (10-day range ÷ ADR)${c.adrPct > A.MAX_ADR_PCT ? " — meaningless at this ADR; any range looks tight against a 50% daily swing" : c.tightness < 3 ? " — coiled" : " — loose"}.`);

  // 6. Market filter
  p.push(market ? `Market filter: ${market.verdict === "bullish" ? "on — QQQ/SPY above rising 10/20; breakouts have a tailwind" : `off — ${market.reason.split(" — ")[0]}. His first rule: size down or wait when the index is below its averages`}.` : "Market filter: no index data.");
  if (!f.marketOk) v = worst(v, "wait");

  return { verdict: v, points: p };
}

function livermore(c: Candidate, f: Facts): FrameworkView {
  const p: string[] = [];
  if (c.pivot === null) {
    p.push("No confirmed pivotal point in the last six months — no swing high that held with lower highs on both sides. Nothing to act on yet.");
    return { verdict: "wait", points: p };
  }
  const dist = c.pivot / f.last.c - 1;
  if (f.last.c <= c.pivot) {
    p.push(`Pivotal point at ${fmt(c.pivot)}, ${pct(dist, 1)} above the close — the resistance the whole recent history respects.`);
    p.push("His rule: wait for the break and then act without hesitation; never buy in anticipation of it.");
    if (f.parabolic) p.push("But the tape is parabolic; he would not be looking for longs here.");
    return { verdict: f.parabolic ? "pass" : "wait", points: p };
  }
  // already above the pivot
  const firstAbove = f.bars.findIndex((b, i) => i > 0 && b.c > c.pivot! && f.bars.slice(0, i).slice(-20).every((x) => x.c <= c.pivot!));
  const brokeAgo = firstAbove < 0 ? 0 : f.bars.length - 1 - firstAbove;
  const above = f.last.c / c.pivot - 1;
  const breakClose = firstAbove >= 0 ? f.bars[firstAbove].c : c.pivot;
  p.push(`Pivotal point ${fmt(c.pivot)} was broken ${brokeAgo === 0 ? "today" : `${brokeAgo} session${brokeAgo === 1 ? "" : "s"} ago`}; price is ${pct(above, 1)} above it.`);
  if (brokeAgo === 0) {
    p.push("Today is the break — exactly the signal he acted on, provided it closes strong and the general market is with you. On end-of-day data the earliest entry is tomorrow's open, if it holds above the pivot.");
    return { verdict: f.parabolic ? "pass" : "wait", points: p };
  }
  if (f.last.c < breakClose) {
    p.push(`No follow-through: it closed at ${fmt(breakClose)} on the break and ${fmt(f.last.c)} now. He read a break that does not carry as a failing move.`);
    return { verdict: "pass", points: p };
  }
  if (above > A.CHASE_PCT) {
    p.push(`Buying now is chasing — entering ${pct(above, 1)} past the signal with a stop that no longer references the pivot.`);
    return { verdict: "pass", points: p };
  }
  p.push("Still within a few percent of the pivot with follow-through — a late but valid entry tomorrow if it holds, stop under the pivot.");
  return { verdict: f.parabolic ? "pass" : "wait", points: p };
}

function minervini(c: Candidate, f: Facts): FrameworkView {
  const p: string[] = [];
  const vcp = readVcp(f.bars);
  const pivot = c.box?.top ?? vcp?.baseHigh ?? null;
  if (!vcp || vcp.contractions.length < CONFIG.VCP.MIN_CONTRACTIONS) {
    p.push(
      `No readable contraction sequence in the last ${CONFIG.VCP.BASE_LOOKBACK} sessions — a VCP needs at least ${CONFIG.VCP.MIN_CONTRACTIONS} successive pullbacks to compare. Nothing to judge yet.`,
    );
    return { verdict: f.parabolic ? "pass" : "wait", points: p };
  }
  const depths = vcp.contractions.map((d) => `${(d * 100).toFixed(0)}%`).join(" → ");
  const final_ = vcp.contractions[vcp.contractions.length - 1];
  p.push(
    `${vcp.contractions.length} contraction${vcp.contractions.length === 1 ? "" : "s"} in the base: ${depths} — ${vcp.shrinking ? "each shallower than the last, the signature he wants" : "not progressively shrinking; he calls a base like this wide and loose"}.`,
  );
  const dry = f.vol20 > 0 && f.vol5 / f.vol20 < A.VOL_DRYUP;
  p.push(
    `Volume ${dry ? `drying up into the right edge (5-day ${(f.vol5 / f.vol20).toFixed(1)}× the 20-day) — supply gone, as he demands before the pivot` : `not drying up (5-day ${f.vol20 > 0 ? (f.vol5 / f.vol20).toFixed(1) : "?"}× the 20-day) — he wants the final leg quiet`}.`,
  );
  if (f.parabolic) {
    p.push("The tape is parabolic — outside his playbook entirely.");
    return { verdict: "pass", points: p };
  }
  if (f.last.c < vcp.baseLow) {
    p.push(`Closed below the base low ${fmt(vcp.baseLow)} — the pattern failed; he would be out or standing aside.`);
    return { verdict: "pass", points: p };
  }
  if (!vcp.shrinking && final_ >= vcp.contractions[0]) {
    p.push("Right side wider than the left — expanding volatility is his clearest disqualifier.");
    return { verdict: "pass", points: p };
  }
  if (final_ > CONFIG.VCP.MAX_FINAL_PCT) {
    p.push(`Final contraction ${(final_ * 100).toFixed(0)}% is deeper than his ${(CONFIG.VCP.MAX_FINAL_PCT * 100).toFixed(0)}% ceiling — the tight zone hasn't formed; wait for it.`);
    return { verdict: "wait", points: p };
  }
  p.push(
    vcp.shrinking
      ? `VCP ${dry ? "fulfilled" : "formed, volume not yet quiet"}: final contraction ${(final_ * 100).toFixed(0)}%${pivot !== null ? `, pivot ${fmt(pivot)}` : ""}. His entry is the pivot break on expanding volume — on EOD data that is tomorrow's open, if it clears and holds.`
      : `The right edge is tight (${(final_ * 100).toFixed(0)}%)${pivot !== null ? ` under pivot ${fmt(pivot)}` : ""}, but the sequence never contracted cleanly — not a VCP he would call by the book; a pivot break deserves extra caution.`,
  );
  return { verdict: "wait", points: p };
}

function darvas(c: Candidate, f: Facts): FrameworkView {
  const p: string[] = [];
  if (!c.box) {
    p.push(`No box: ${f.sinceHigh <= 2 ? "the stock is still making new highs, so no ceiling has held" : "the recent range is too tall to count as a box"}. Darvas waited for a top to hold for several sessions and a floor to form under it.`);
    if (c.adrPct > A.MAX_ADR_PCT) p.push(`At ${c.adrPct.toFixed(0)}% ADR any box that forms will be wide; a normal candle would take out the stop.`);
    return { verdict: f.parabolic ? "pass" : "wait", points: p };
  }
  const risk = c.box.top / c.box.bottom - 1;
  const toTrigger = c.box.top / f.last.c - 1;
  const dry = f.vol20 > 0 && f.vol5 / f.vol20 < A.VOL_DRYUP;
  p.push(`Box ${fmt(c.box.bottom)}–${fmt(c.box.top)} (${(risk * 100).toFixed(0)}% tall, ${f.restDays} sessions, ${c.box.confirmed ? "floor confirmed" : "floor not yet confirmed"}).`);
  p.push(`Volume ${dry ? `drying up inside the box (5-day ${money(f.vol5)} vs 20-day ${money(f.vol20)} shares) — the quiet he wanted before a break` : `not drying up (5-day ${(f.vol5 / f.vol20).toFixed(1)}× the 20-day) — the box is still being fought over`}.`);
  let v: Verdict;
  if (f.last.c < c.box.bottom) {
    p.push(`Closed below the box bottom — the setup failed by his rule; sell or stand aside.`);
    v = "pass";
  } else if (risk > A.MAX_BOX_RISK) {
    p.push(`Trigger ${fmt(c.box.top)}, stop ${fmt(c.box.bottom)}: ${(risk * 100).toFixed(0)}% risk is too wide to size sensibly.`);
    v = "pass";
  } else if (f.breakingOut) {
    p.push(`Broke the box top ${fmt(c.box.top)} today${f.last.v > f.vol20 * 1.5 ? " on expanding volume" : " on ordinary volume — he wanted volume on the break"}. Stop at the box bottom ${fmt(c.box.bottom)} (${(risk * 100).toFixed(0)}% risk).`);
    v = "wait"; // the break is known only after the close; act at tomorrow's open if it holds
  } else if (f.last.c > c.box.top) {
    p.push(`Already ${pct(-toTrigger, 1)} above the box top — the break happened earlier; only a pullback to the top of the box gives a Darvas entry now.`);
    v = "wait";
  } else {
    p.push(`Trigger ${fmt(c.box.top)} is ${pct(toTrigger, 1)} above the close; stop ${fmt(c.box.bottom)} → ${(risk * 100).toFixed(0)}% risk on the break. Buy only when it leaves the box upward.`);
    v = "wait";
  }
  return { verdict: v, points: p };
}

/** Rule-based read of one candidate through all three frameworks. Pure. */
export function analyzeCandidate(c: Candidate, market: MarketHealth | undefined): Analysis {
  const f = facts(c, market);
  const q = qullamaggie(c, f, market);
  const l = livermore(c, f);
  const d = darvas(c, f);
  const m = minervini(c, f);
  const overall = worst(q.verdict, l.verdict, d.verdict, m.verdict);
  let plan: string | null = null;
  if (c.box && f.last.c >= c.box.bottom && c.box.top / c.box.bottom - 1 <= A.MAX_BOX_RISK) {
    const boxRisk = ((c.box.top / c.box.bottom - 1) * 100).toFixed(0);
    // Two stops: the structural one (Darvas box bottom) and the tighter one Kullamägi
    // actually uses (low of the breakout day). The latter is only known once it breaks.
    const tight = f.breakingOut
      ? `or ${fmt(f.last.l)} (today's low, ${((c.box.top / f.last.l - 1) * 100).toFixed(0)}%)`
      : "or the breakout day's low (tighter, typically 3–5%)";
    plan = `Buy stop ${fmt(c.box.top)} · stop ${fmt(c.box.bottom)} (box bottom, ${boxRisk}% risk) ${tight}`;
  }
  const summary =
    overall === "pass"
      ? f.parabolic
        ? "Pass — parabolic spike, no base; not a swing setup under any of the three."
        : "Pass — at least one framework reads this as failed or already gone."
      : f.breakingOut
        ? `Wait — broke the box today; buy tomorrow's open only if it holds above ${fmt(c.box!.top)}${f.marketOk ? "" : "; market filter is off"}.`
        : `Wait — ${c.box ? "setup is forming, act only on the break" : "no box yet, nothing to act on"}${f.marketOk ? "" : "; market filter is off"}.`;
  return { ticker: c.ticker, date: c.bars[c.bars.length - 1].date, overall, summary, plan, qullamaggie: q, livermore: l, darvas: d, minervini: m };
}
