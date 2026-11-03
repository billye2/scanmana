import { CONFIG } from "./config";
import { armBlocker, sizeShares } from "./paper-engine";
import { defaultTakeStop } from "./stop-plan";
import type { Bar, Candidate } from "./types";

/**
 * The card's plan box, in words: what the Auto book does with this card on the
 * scan night (`autoPlan`) and what a manual Take would risk (`takeRisk`). Pure —
 * the sentences are written from the same functions the books run on
 * (`armBlocker`, `defaultTakeStop`, `sizeShares`), so the card can never say
 * one thing and the ledger do another.
 */

const K = CONFIG.PAPER.KULLAMAGI;

export type PlanTone = "green" | "red" | "neutral";

export interface AutoPlan {
  arms: boolean;
  /** Short chip text, e.g. "arms · buy at open". */
  chip: string;
  tone: PlanTone;
  /** One or two sentences under the chip. */
  detail: string;
}

const fmt = (n: number) => n.toFixed(2);
const signedPct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

const RULE = "Arms only a boxed Wait card on its first close above the box: a buy at the next open, stop at that day's low.";

/** What the Auto book does with this card tonight. Null until the card's bars are loaded. */
export function autoPlan(card: Pick<Candidate, "box" | "verdict">, bars: Bar[] | null): AutoPlan | null {
  if (!bars || bars.length === 0) return null;
  const last = bars[bars.length - 1];
  const why = armBlocker({ box: card.box, verdict: card.verdict, bars });
  if (why === null) {
    return {
      arms: true,
      chip: "arms · buy at open",
      tone: "green",
      detail: `Closed above the box. Stop at that day's low ${fmt(last.l)} (${signedPct(last.l / last.c - 1)} from the close); half off at the day-${K.PARTIAL_DAY} open if day ${K.PARTIAL_DAY - 1} closes above entry, then breakeven, out on a close under the ${K.MA}-day.`,
    };
  }
  switch (why) {
    case "no box":
      return { arms: false, chip: "not armed · no box", tone: "neutral", detail: RULE };
    case "verdict pass":
      return { arms: false, chip: "not armed · verdict Pass", tone: "red", detail: `${RULE} A Pass card is never bought, whatever price does.` };
    case "closed below the box bottom":
      return {
        arms: false,
        chip: "not armed · under the box",
        tone: "red",
        detail: `Closed below the box bottom ${fmt(card.box!.bottom)}: the box has failed.`,
      };
    case "broke out earlier":
      return {
        arms: false,
        chip: "not armed · broke out earlier",
        tone: "neutral",
        detail: "The first close above the box came before this session, and the Auto book buys only that one. A manual Take at open is still priced below.",
      };
    default:
      return {
        arms: false,
        chip: "waits · inside the box",
        tone: "neutral",
        detail: `Arms on a close above ${fmt(card.box!.top)} (${signedPct(card.box!.top / last.c - 1)} from the close), buying the next open with the stop at that day's low.`,
      };
  }
}

/** Where a card sits on the deck list: what happens to it at the open. */
export type OpenGroup = "arms" | "inside" | "watch" | "pass";

/** The list's sections in reading order, with the sub-line each heading carries. */
export const OPEN_GROUPS: { key: OpenGroup; title: string; sub: string }[] = [
  { key: "arms", title: "Arms tonight", sub: "buy at open" },
  { key: "inside", title: "Inside the box", sub: "waiting for a close above" },
  { key: "watch", title: "Wait · not armed", sub: "no box, broke out earlier or under the box" },
  { key: "pass", title: "Pass", sub: "folded" },
];

/**
 * The card's list group, from the same `armBlocker` the Auto book arms with.
 * Needs only the last two bars. Without bars a Wait card inside a box reads as
 * "inside", since a box that has not been closed above is the common case.
 */
export function openGroup(card: Pick<Candidate, "box" | "verdict">, bars: Bar[] | null | undefined): OpenGroup {
  if (card.verdict !== "wait") return "pass";
  if (!bars || bars.length === 0) return card.box ? "inside" : "watch";
  const why = armBlocker({ box: card.box, verdict: card.verdict, bars });
  if (why === null) return "arms";
  return why === "waiting for a close above the box" ? "inside" : "watch";
}

/**
 * The row's one-line hint under the ticker: the Take numbers for a name that
 * arms (stop · risk · shares), the distance to the trigger inside the box,
 * nothing otherwise.
 */
export function openHint(card: Pick<Candidate, "box" | "pivot" | "price">, group: OpenGroup, bars: Bar[] | null | undefined, tapeMult = 1): string | null {
  if (group === "arms") {
    const r = takeRisk(card, bars ?? null, tapeMult);
    return r ? `stop ${fmt(r.stop)} · risk ${(r.riskPct * 100).toFixed(1)}% · ${r.shares} sh` : null;
  }
  if (group === "inside" && card.box) return `${signedPct(card.box.top / card.price - 1)} to trigger`;
  return null;
}

export interface TakeRisk {
  entry: number;
  stop: number;
  /** (entry − stop) / entry */
  riskPct: number;
  /** Whole shares at the notional × tape multiplier (0 = one share costs more). */
  shares: number;
  atOpen: boolean;
}

/**
 * What a Take would risk, priced the way the Take route prices it: under the
 * trigger a buy-stop at the trigger with the box bottom as the stop; above it a
 * buy at the next open (entry ≈ the last close) with `defaultTakeStop`. Null when
 * there is no trigger or no stop line.
 */
export function takeRisk(card: Pick<Candidate, "box" | "pivot" | "price">, bars: Bar[] | null, tapeMult = 1): TakeRisk | null {
  const trigger = card.box?.top ?? card.pivot ?? null;
  if (trigger === null) return null;
  const atOpen = card.price > trigger;
  const entry = atOpen ? card.price : trigger;
  const stop = bars && bars.length > 0 ? defaultTakeStop(bars, trigger, card.box?.bottom ?? null) : (card.box?.bottom ?? null);
  if (stop === null || stop >= entry) return null;
  return { entry, stop, riskPct: 1 - stop / entry, shares: sizeShares(entry, tapeMult), atOpen };
}
