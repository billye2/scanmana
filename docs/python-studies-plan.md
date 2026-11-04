# Python studies — five releases plus the page they live on

**Status (2026-11-03, PST evening):** R0 ✅ 1.7.5 · R1 ✅ 1.7.6 · **R2 next** · R3 · R4 · R5. Work one module per step, mind context and session limits, report after each (Billy's rule). A release that needs a migration says so first: `npm run migrate` is Billy's to run (`!`).

**Approved by Billy in the Lavish explainer `.lavish/python-heavy-lifting.html` (git-ignored).** His picks, in build order: confidence bands → follow-through paths → stable theme ids → exit sweep → drawdown fan. Not picked: relative-strength deciles (and the deck keeps tightest-first regardless). Answers to the three questions: (1) **the exit routine may change** — if the paths and the exit sweep are clear at 30+ rows with ranges apart, change it as a scored `RULE_CHANGES` row; (2) **the research page keeps to the read, the scorecard and the rule changes; the studies live on `/studies`** in the gear's list; (3) relative strength is study only, not picked.

House rules that hold throughout: one release per change; numbers from code, words from fixed templates; a card earns its place only if it changes a take, a skip or a stop (2026-09-23) — the drawdown fan is the one exception Billy chose knowingly, as understanding; nothing shorts; the ADR floor stays 3.5 (standing instruction); Python jobs stay inside the 280 s nightly budget and reuse bars already loaded.

## R0 — `/studies` ✅ 1.7.5

Moved off `/research`: breakout rates, the threshold sweep, breadth, themes on tonight's deck + themes scored, Kullamägi's plan on every boxed Wait card, the EP study. `/research` keeps this week's read, the scorecard, the rule-change table, Maintenance. Shared primitives in `components/ResearchPrimitives.tsx`. `studies` in the nav registry after `research` (`BookOpenIcon`, off the default six). Help `#studies`.

## R1 — confidence bands ✅ 1.7.6

`lib/stats.ts` (pure): `wilson` for rates, `meanInterval` (mean ± 1.96·sd/√n) for averages, `diffInterval`, `separated`, `formatInterval`. `components/Band.tsx` draws the range under the number. Wired into the scorecard tiles, the rule-change rows (coloured only when ready **and** the two ranges are apart; amber while they overlap; `researchRead` gives no verdict on an overlapping change), the plan card and themes-scored tables on `/studies`, the verdict table on `/tape`. Readers return `stddev_samp` as `sdR`/`sdKR`; `PeriodSums.waitRSumSq`. Closed-form on purpose, no bootstrap.

## R2 — follow-through paths (next)

**Migration first:** one table.

`research/outcomes.py` writes `research_paths (date, ticker, day smallint 1..20, gain double, low double, PRIMARY KEY (date, ticker, day))` for every boxed Wait row with a `k_entry_day` (the Auto plan's entry: the open after the first close above the box): gain = close_d / entry − 1, low = min(low_1..d) / entry − 1. Incremental with the row's `complete` flag (re-label with the plan columns, same chunk loop; the bars are the ones the job already loads). `db/schema.sql` gains the table (no semicolons in comments — the migrator splits on them).

Reader `getPaths()` in `lib/research.ts` → per day 1..20: mean and median gain, mean low, n; split: all / ADR bucket (3.5–5, 5–7, 7+) / tape at scan (Bullish, Not) / stop width (≤1 ADR, wider). One query with `percentile_cont`.

Card on `/studies` under the plan card: `components/PathChart.tsx` (server SVG like `TapeCharts`): mean gain line per split with the day-4 and 10-day markers (`CONFIG.PAPER.KULLAMAGI.PARTIAL_DAY`, `MA`), the mean-low line dashed below; splits as tabs via `?split=`. A fixed-template sentence from pure `lib/paths-read.ts` (tested): the day the mean gain peaks, gain at day 4 vs day 10 vs day 20, the day the mean low bottoms. Help term. Decides, with R4, whether the routine changes.

## R3 — stable theme ids

**Migration first:** `theme_id` on `research_cluster_history`, new `research_themes`, `theme_id` on `research_cluster_alias`.

`research/clusters.py` chains each night's clusters to the prior night's by member Jaccard overlap (≥ 0.5 → same theme; else a new id; a cluster overlapping two prior themes takes the larger; a theme unseen for 10 nights ends), writing `theme_id` into the history and `research_themes (theme_id, first_night, last_night, current_key, nights)`. Aliases attach to the id (keys kept for back-compat; the alias control writes both). Themes scored collapses to one row per theme with lifespan and a strength line over time; the deck's theme line reads the alias by id. `tests/py` for the chaining on a hand-built three-night sequence (split, merge, gap).

## R4 — exit sweep

`research/sweep.py` gains a grid over the routine on all boxed Wait rows with a plan entry: partial day {3, 4, 5} × exit MA {10, 20} × breakeven {on, off}; `_replay_kullamagi` in `replay.py` gains `partial_day` and `breakeven` parameters (it has `ma`). Rows into `research_sweep` under params `EXIT_PARTIAL_DAY`, `EXIT_MA`, `EXIT_BREAKEVEN` plus a combined `EXIT_GRID` key (value encodes the cell); `tests/py/test_sweep.py` pins the grid's "current" cell to `CONFIG.PAPER.KULLAMAGI`. Card on `/studies` as a 12-cell grid with today's routine marked, bands (R1) in each cell. **Gate for the rule change:** the best cell beats today's cell on avg R with both n ≥ 30 and ranges apart, and the paths (R2) agree on the direction; then one `RULE_CHANGES` row, lens paper avg R, and `CONFIG.PAPER.KULLAMAGI` changes with the numbers in the comment.

## R5 — drawdown fan

**Migration first:** `research_mc`.

`research/mc.py`: 5,000 shuffles of the plan's `k_r` distribution into sequences of 1..60 trades; writes `research_mc (trades, q05, q25, q50, q75, q95)` of cumulative R; added to `research/run.py` ORDER after `replay`, small budget. Reader + card on `/paper` under the replay line: the Auto book's actual cumulative R path over the bands (server SVG), and a template sentence: "the book's N trades sit at the Xth percentile of what this plan's history produces by chance". Help term.

## Not doing

Relative-strength deciles and any deck re-ranking (answer 3). Charts rendered in Python. Any EP change. Moving the ADR floor.
