# Are the arming rules missing trades? The read behind the shadow rule (2026-11-15)

Billy's question: "I am just trying to figure out if some opportunities were missed due
to the wrong auto arming requirements." This note keeps the numbers that answered it and
the one thing the check found, which shipped in 1.9.4 as a shadow rule on `/studies`:
scored beside the live rule, never armed.

## Method

Read from production on 2026-11-15 (`scan_history × research_outcomes` and the stored
bars; scan nights 2026-03-04 to 2026-10-16, the last night with twenty sessions after it).

- **One row per trade.** A card rests in its box for many nights, so only the scan night
  right before the breakout day counts (`k_entry_day = 2`). That night's verdict stands
  in for the breakout night's.
- **One plan throughout.** Buy the open after the first close above the level, stop at
  that day's low, the Auto book's exits over twenty sessions (`_replay_kullamagi`). For
  boxed cards the level is the box top and R is the stored `k_r`; for the other levels
  the same function was run from a scratch script.
- **Tie-out.** The recomputed box trades match the stored `k_r` on all 526 rows.
- Deck cards only. In-sample, raw price, no slippage.

## Who decides what arms

Three people's rules, not one. Kullamägi: the screen, the entry timing (first close above
the level, buy the next open) and the one-ADR stop limit. Darvas: the box and its top,
and a veto when the box is over 15% tall or the close is under its bottom. Minervini: a
veto when the close is under the base low or the contractions widen. Kullamägi's own
softer objections (market filter off, rest outside 2–8 weeks, averages not all rising)
read "Wait" and so do not block arming.

## What each gate kept out

| Group | Trades | Win | Avg R | Total R | 3R+ |
|---|---|---|---|---|---|
| Armed (deck, Wait, stop within one ADR) | 118 | 41% | +0.34 | +39.8 | 13 |
| Blocked: stop wider than one ADR | 62 | 42% | −0.18 | −10.9 | 1 |
| Blocked: Darvas or Minervini veto | 346 | 41% | +0.01 | +2.2 | 20 |
| Not in the deck: failed the screen | 412 | 37% | −0.10 | −42.7 | 17 |

Where the veto was the only blocker (stop within one ADR): Minervini alone −0.21R on 82,
both −0.27R on 77, Darvas alone +0.15R on 38. The gates are not costing trades.

## No-box cards

Level = the highest high of the 20 sessions ending on the scan night (the 10- and
50-session highs give the same trades: at a fresh high the three coincide).

| No-box cards, stop within one ADR | Trades | Win | Avg R | Without the best trade |
|---|---|---|---|---|
| Every signal | 661 | 32% | −0.01 | −0.13 |
| One position per ticker at a time | 486 | 34% | +0.08 | −0.09 |

The best trade is an artefact: ASST, 82R, because the entry open was 3.5 cents over the
stop. 647 of the 661 had made a 60-day high in the three sessions before, so "no box"
means "already running". Not a missed opportunity.

## Darvas out of the equation

| Approach | Trades | Win | Avg R | Total R | Without the best trade |
|---|---|---|---|---|---|
| Today | 118 | 41% | +0.34 | +39.7 | +0.21 |
| A. No box: any close over the 20-session high, Minervini veto, stop ≤ 1 ADR | 517 | 34% | +0.05 | +25.6 | −0.11 |
| B. Close over a 50-session high at least 3 sessions old, Minervini veto, stop 0.1–1 ADR | 103 | 49% | +0.51 | +53.0 | +0.37 |

B looked better, so the two sets were compared trade by trade:

| | Trades | Win | Avg R | Total R |
|---|---|---|---|---|
| In both | 74 | 49% | +0.61 | +45.2 |
| Only today's rule | 44 | 27% | −0.12 | −5.4 |
| Only B | 29 | 48% | +0.27 | +7.9 |

B's gain is subtraction. 43 of the 44 trades only today's rule takes closed over the box
top and under the 50-session high. B's additions are 26 tall-box cards (+0.19R, about
zero without POWL) and 3 no-box cards. Removing Darvas is not what helps.

## The shadow rule

Keep today's rule and add one condition: the close that breaks the box must also be above
the highest high of the 50 sessions before it. A box top is the most recent ceiling that
held, so an older, higher high can sit above it; the live rule buys the break of that
lower high.

| Today's 118 trades | Trades | Win | Avg R | Total R | 3R+ |
|---|---|---|---|---|---|
| Shadow keeps | 75 | 49% | +0.68 | +51.2 | 11 |
| Shadow drops | 43 | 26% | −0.27 | −11.4 | 2 |

It costs two good trades (MTRN +4.5R, WSC +3.1R).

## Why it is a study and not a rule

The split was found by cutting the same eight months several ways, on 43 dropped trades.
July and August lose under every approach. So the card on `/studies` keeps the history
above apart from the scan nights after 2026-10-16 and reads only those: thirty new trades
on each side with the two ranges apart. At about 15 armed trades a month, 6 of them
dropped, that is roughly five months. If the gate is met the condition joins `armBlocker`
as one `RULE_CHANGES` row. If the new trades run the other way, the card comes out.

Two more readings from the same tables, recorded and not acted on: armed trades on a
Bullish night made +0.97R on 32 against +0.10R on 86 (one 15.5R trade is half of the
first), and stops under half an ADR made −0.25R on 35.
