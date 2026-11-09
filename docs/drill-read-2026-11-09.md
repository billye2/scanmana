# The first drill read — entry does not guarantee success (2026-11-09)

Billy ran the first eighteen charts on `/drill` (1.8.5/1.8.6) the day it shipped and
failed more than he passed. His questions: "what am I missing? a 5 star setup is not
necessarily a winner? am I more of a stop manager to be more successful?" This note
keeps the numbers the discussion was built on and the conclusion he confirmed:
**be a better stop and exit manager — the entry does not guarantee success.**

Read from production the same day (`scan_history × research_outcomes`, deck rows with
twenty sessions of follow-through, scan nights in the last 260 days). "Ran" is the
drill's definition: best close in twenty sessions at least 15% over the scan-night
close (`CONFIG.DRILL.RAN_MFE`). "Never" is `broke_10d = false`: no close above the
level in ten sessions, a buy-stop would not have filled.

## Billy's eighteen calls

| Call | Count |
|---|---|
| Takes that ran | 3 (SNDK, FSLY, AXGN) |
| Takes that fizzled | 5 (DNTH, COMP, GPRE, LITE, WLK) |
| Takes that never filled | 3 (MANH, MXL, TPL) |
| Skips that were right | 4 (LTH, BHVN, DAVE, CXW) |
| Skips that ran away | 3 (LYB, MTRN, TXG) |
| Graded hit rate | 7 of 15 = 47% |

Pattern, with the caveat that eighteen rows is noise: the takes leaned toward big ADR
and huge three-month moves (SNDK 8.7% ADR / +199% 3M, FSLY 9.9% / +160%, MXL 14.2% /
+414%, LITE 7.7% / +131%); the skips that ran were slower names (LYB 4.6% / +51%,
MTRN 4.1% / +35%, TXG 7.3% / +73%). The glamour chart is not the one that runs more
often. Thirteen of the eighteen charts were on a Not bullish night, because most of the
stored history is.

## The history behind it (8,001 rows)

| All scored deck rows | Share |
|---|---|
| Never cleared the level in ten sessions | 38% |
| Ran 15% or more | 29% |
| Ran, given it filled | 47% |
| Median best close in twenty sessions | +8.9% |
| Median worst close in twenty sessions | −8.4% |

| Split | n | Ran | Never | Plan win rate | Plan avg R |
|---|---|---|---|---|---|
| 5-star rows (boxed Wait under the box top) | 1,290 | 26% | 39% | 42% | −0.03 |
| Everything else | 6,711 | 29% | 38% | 40% | 0.00 |
| Bullish tape | 2,202 | 40% | 32% | | |
| Not bullish tape | 5,799 | 25% | 40% | | |

Plan = the Auto book's Kullamägi plan on the rows it would have entered (`k_r`, 2,012
rows): win rate 41%, average win +1.4R, average loss −0.9R, net about zero.

## What it says

1. **A 47% hit rate is the base rate given a fill.** Nobody reads the left side of a
   chart at 70%. Kullamägi put his own hit rate at 25 to 50%. The drill is honest about
   this, which is why it feels like failing.
2. **The 5-star rule is a shape filter, not an edge.** On six times the rows of the
   2026-11-03 gallery read, boxed-Wait-under-the-top runs slightly *less* often than the
   rest and the plan on it averages about zero R. Same conclusion as 1.6.7, in-sample.
3. **The tape is the one factor in this history that separates**: 40% ran on a
   Bullish night against 25% on a Not bullish one, and fewer never filled. His first
   rule; the shape rule cannot make up for it.
4. **The edge is in management.** Two of the three hits (SNDK, FSLY) drew down about
   20% inside the twenty sessions on the way to running; a one-ADR stop is out of both
   before the move. And the plan's own record, 41% wins at +1.4R against −0.9R losses,
   nets to zero: picking better moves the 41% a little, holding the runners longer
   moves the +1.4R a lot. The exit sweep on `/studies` is where that question is
   answered; the exit rule changes only when its gate says so (one module per step).

## Confirmed direction

Billy, 2026-11-09: "it confirms the idea of being a better stop manager as entry does not
guarantee success." Work that serves this, in order of what the data supports:

- the tape as the first decision (already the mission's first rule; the drill's covered
  state shows it in the facts line);
- the exit routine, through the `/studies` sweep gate, never by hand;
- a second drill question after a Take — place the stop on the covered chart, then see
  whether it survived and what the plan's exit made in R (`lib/stop-plan.ts` already
  prices the stop for the Take button and `/sim`). Not built yet; his call.

Not a rule change. In-sample, raw price, no slippage.
