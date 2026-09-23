# Scanmana

> Current project state, infra gotchas, and open questions live in [HANDOFF.md](HANDOFF.md) — read that first.

Personal EOD momentum scanner as a mobile-first PWA. Engine: Qullamaggie-style
breakout screens (momentum leaders in tight consolidations) with Darvas boxes
and Livermore pivotal points drawn on each chart as entry-trigger / stop-zone
overlays. A Python research layer scores the scanner's own history every night
(`/research`) and scores every rule change made from it.

## Screenshots

| Deck | Analysis | Live watchlist |
|---|---|---|
| ![Deck: tonight's ranked setups with Darvas box, Livermore pivot and stop drawn on the chart](docs/screenshots/deck.png) | ![Analysis: rule-based Wait/Pass read per framework with the trade plan](docs/screenshots/analysis.png) | ![Live watchlist: starred names classified against their trigger in real time](docs/screenshots/watchlist-live.png) |

| Symbol lookup | Help |
|---|---|
| ![Symbol lookup: the same card for any ticker plus the Scan fit checklist](docs/screenshots/symbol-lookup.png) | ![Help: every badge and chart line explained, with who each idea comes from](docs/screenshots/help.png) |

## How it works

- A nightly Vercel cron (`/api/cron/scan`, weeknights ~midnight ET) pulls the whole
  US market's daily bars in **one** grouped-daily API call (Massive, formerly
  Polygon.io — free Basic tier), upserts them into Neon Postgres, runs the
  screens, stores the ranked result, and sends one web-push notification.
- The PWA is a thin viewer: a deck of annotated candidate charts (the page
  embeds bars only for the card on screen and its neighbours — ~12 KB gzipped
  instead of ~75 KB — and fetches the rest per card from `GET /api/scan/bars`
  as you page, neighbours prefetched), paged from a
  fixed bottom bar of line icons (prev · watch · deck list · paper book · Google · next)
  (wraps around: past the last card comes the first, and vice versa)
  (lightweight-charts), a watchlist with "broke its box" alerts, and a `/help`
  page that carries the **↻ Run scan for previous day** button
  (`POST /api/scan/run` — no secret, never forces, so it can only run the scan
  the cron would).
- **One top nav on every page** (`components/TopNav.tsx`): the ◎ Scanmana logo
  always goes home, a page line sits under it, and the same four icons sit on
  the right — Help, symbol lookup, ★ Watchlist, paper book, deck list — with the current
  page's icon lit. The symbol page adds its Live toggle beside them.
- **Paper trading** (`/paper`, `lib/paper-engine.ts` + `lib/paper-db.ts`): two
  ledgers priced on the same end-of-day bars, run right after each nightly scan.
  *Auto* arms a buy-stop at the box top of every boxed Wait card (stop at the box
  bottom, no cash cap) and trails the stop up to the lowest low of the
  last 10 sessions — hands off, it measures the scanner. *Manual* is a $10k
  account, cash binds: **Take** on a card or watchlist row arms
  the same buy-stop; raise the stop, pick a percent or N-session-low trail, or
  queue a partial sell at the next open. Price already above the trigger (the
  breakout-day cards, or a late Take) means a market buy at the next open with
  the same stop — a buy-stop under the market is not an order a broker takes.
  Fills: first session whose high reaches the trigger (at the open if it gapped past); stops: any session whose low
  touches it (at the open if it gapped under); an entry day that also touches the
  stop is a same-day stop-out. No commissions, no slippage; a 40%+ overnight gap
  is flagged "check for a split". Win rate, expectancy in R, profit factor and a
  realized equity curve per ledger. **Position size follows the tape**
  (`lib/tape.ts`): $500 when the index filter is Bullish *and* breadth is at
  least 50%, $250 when one of the two holds, $125 when neither — the market
  strip, the paper page and the nightly push say which applies. Measured
  reason: the same setups averaged +0.11R when Bullish and −0.11R when not.
- **Market strip** above the deck: Kullamägi's index filter on QQQ/SPY —
  10-day > 20-day, price above the 20 and 50, all three rising → **Bullish**,
  otherwise **Not bullish** naming the failing condition. `/help#market`
  charts both ETFs with their 10/20/50 SMAs. Every chart has a **30d / All**
  pill: zoom to the last 30 sessions, tap again for the full window (the deck
  keeps the setting as you swipe). A
  second line carries **breadth** from the research layer — share of the
  whole universe above its 20-day average, new 63-day highs / lows — amber
  when the index says Bullish on a thin tape, plus tonight's paper size.
- `/help` explains every badge and chart line (ADR, tightness, EP, Darvas
  trigger/stop, Livermore pivot, the SMAs), who each idea comes from and how
  to trade it — numbers read live from `lib/config.ts`.
- **Analysis (Wait / Pass)** button under each symbol — the label is the
  overall verdict, stamped on the candidate at scan time — opens a rule-based read of the card
  through Kullamägi's breakout rules, Livermore's pivotal point, the Darvas
  box and Minervini's VCP (progressively shallower contractions, volume
  dry-up, pivot) — Wait / Pass per framework with the reasons (no "Take": EOD data can
  only say what to watch at tomorrow's open, never to buy now), plus a trade plan
  (trigger · stop · risk) when one exists. The card's verdict is the worst of
  Kullamägi, Darvas and Minervini; Livermore's read is shown but does not veto
  (since 1.3.0 — the cards his "chasing" objection alone turned to Pass broke
  out as often as the Wait cards and ran further). Computed at scan time
  (`lib/analysis.ts`), stored in the `analyses` table, served by
  `GET /api/analysis`. `npm run analyze` recomputes for the latest scan.
- **Research** (flask icon → `/research`, `research/*.py` on a Vercel Python
  3.13 function chained after each scan): every loose-screen passer is
  recorded nightly in `scan_history`, then six jobs score it — **outcomes**
  (did each deck name close above its level within 10 sessions; the level is
  the box top, else the pivot while overhead, else the 20-session high — hit
  rate by verdict, badge and which framework objected), **threshold sweep**
  (deck size and hit rate at every setting of each screen floor, current one
  marked), **themes** (price-only clusters of the liquid universe on
  market-residual return correlation; the deck card says "Moves with …" and
  links the deck-mates), **splits** (unadjusted gaps that look like splits;
  confirmed ones rescale the bars the scan and charts use, ambiguous ones wait
  in a review list), **breadth** (per day, back to the start of the bars), and
  **paper replay** (closed paper trades under trail 5/10/15/20, a fixed 8% and
  half-off-at-2R). The page reads top-down as one question — is the scanner
  working, did the last rule change help: a **scorecard** (four numbers, all
  history vs since the last change), the **rule changes** (`RULE_CHANGES` in
  `lib/research-story.ts`, one entry per shipped change with the number it is
  scored on, grey until 30 rows), then the rates, the sweep (headline knob
  first, curves folded), breadth and tonight's themes; splits, replay and the
  job log live under a collapsed Maintenance block. Each deck card shows
  "Setups like this: N% broke out within 10d (n=…)" for its shape. `npm run research -- --jobs outcomes,sweep --force`
  runs jobs locally against the same DB (needs the `.venv`, see Setup).
- **List** icon (header, next to ★): every setup in tonight's deck on one screen
  with its Wait / Pass chip, price, box and ★ markers, and a tally at the
  top — no need to page through each card. Tap a row to jump the deck to it.
- **Google ↗** (a chip beside the Analysis button and a button beside ☆ Watch) opens a `<symbol> stock` Google search in a new tab (Google's COOP header
  forbids single-tab reuse; the iOS PWA shows it in one in-app sheet anyway). On
  desktop, pressing space opens the search for the current card.
- Watchlist symbols come from ☆ on cards or the **Add** field on `/watchlist`
  (hand-added names get their trigger/stop computed from stored bars).
- **Live watchlist** (top of `/watchlist`): every starred name classified from
  live quotes — ⚡ breaking out, failed back inside, below stop, approaching
  (within 2% of trigger), quiet — with distance to trigger and above/below
  open. Polls every 60s while the page is open; quotes are cached in a shared
  Neon `quotes` table, so every device and function instance shares one
  fetch per symbol per minute (30 min off-hours).
- **Live deck** (home page, `GET /api/scan/live`): the same read for every
  card in tonight's deck — a chip beside the badges, the live price with the
  stored close under it, and the trigger distance from the live price. The
  `/deck` page (list icon in the header, **Deck** in the bottom bar) lists
  the whole deck with a **Live** toggle that groups it breaking / failed /
  stopped / approaching / quiet with a tally; tap a row to open that card. Finnhub's free tier is
  60 calls/min, so each poll refetches at most a budget of stale symbols,
  oldest first (`CONFIG.LIVE`: deck 30, watchlist 25), and serves the rest
  from the cache with their age; a 60-name deck is fully fresh every two
  polls. One bad symbol drops only itself and a 429 halts the refresh
  instead of failing it.
- **Look up any symbol** (search icon in the header → `/s`): type AAPL or NVDA and get the
  same card the deck shows plus a **Scan fit** checklist — each hard rule of
  the nightly screen (`explainScreen` in `lib/screen.ts`, the same list
  `screenTicker` enforces) with the number behind it, so you see exactly why a
  name is or isn't a Scanmana setup, plus an informational Minervini-VCP
  block (contraction sequence, final tightness, volume dry-up — an analysis
  lens, not a screen filter). Deck cards carry the same two panels below the
  buttons, collapsed to one-line summaries (every deck name passes the screen). A **Live** toggle reruns the whole read intraday:
  Finnhub free quotes (symbol + QQQ/SPY, 30-minute in-memory cache) become
  a provisional today-bar — volume assumed at the 20-day average — and the
  market filter recomputes from the live indexes; failures fall back to EOD
  with a note. The Analysis modal for a symbol outside the scan
  is computed on the spot from stored bars and labelled "computed now, not
  stored". Read-only; never touches the nightly results.
- Sign-in via Clerk (Vercel Marketplace): **Google** or an **email code**, no
  password. `proxy.ts` runs `clerkMiddleware`, sends signed-out pages to
  `/sign-in` and answers signed-out API calls with 401. Only allowlisted
  emails can sign up (Clerk dashboard → Restrictions), so the app stays
  single-user. Cron, manifest, service worker and icons stay public. Clerk
  runs as a development instance because production keys need a custom
  domain — see HANDOFF gotcha 4.
- Versioning: taskmana-mobile scheme — 0–9 per segment, `npm run bump`
  advances `package.json` + the `/help` footer line together, release commit
  titles carry `(x.y.z)`. The footer line is how you check what a device runs.
- Mobile-first, but desktop windows (≥1024px) use the full width: the chart
  fills the window, text pages get a wider readable column.
- All thresholds are hardcoded in `lib/config.ts` — tuning is a code edit.

## Screens (lib/config.ts)

Hard filters: price > $10 on every close of the last 21 sessions · 20d avg
dollar volume > $20M · US common stock/ADR · momentum (1M ≥ +25% OR 3M ≥ +50%
OR 6M ≥ +100%) · ADR% between 3.5 and 15 · 1M return ≤ +300% · close above
rising 10/20 SMA · within 5% of 6-month high. The ADR ceiling, return cap
and 21-session price floor are the parabolic guard: a sub-dollar shell that
spiked to $18 passes every floor on today's numbers alone. Ranked with boxed
setups first (there is a level to trade), then by consolidation tightness
(10-day range ÷ ADR). EP badge = 10%+ gap on 3× volume in the last 5
sessions. Verdict = worst of Kullamägi, Darvas and Minervini (Livermore
advisory). Paper trading (`CONFIG.PAPER`): $500 notional per position at full
size — half when only one of the two tape signals (index Bullish, breadth ≥ 50%)
holds, quarter when neither — $10,000 manual start cash, 10-session trail
lookback, 40% split-flag gap. The 5% distance limit and the tape sizing are
the two settings chosen from `/research` numbers (2026-09-20); the research
layer itself screens loosely (`LOOSE_LIMITS` in `lib/screen.ts`: $5, $5M,
ADR 2.5, 30% off the high) so the sweep can re-cut the deck either way.

## Setup

Run `./scripts/setup.sh` — a guided wizard that walks you through the Massive
API key, verifies it, runs the backfill, triggers the first scan, and prints
the iPhone install steps. Manual equivalent:

1. Secrets live only in Vercel env vars (`vercel env add <NAME> production`) — see `.env.example` for the list. Local commands pull them per-process with `vercel env run`; nothing goes in `.env.local`.
2. **Sign-in (Clerk).** `vercel integration add clerk` provisions
   `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` on the Vercel
   project; add `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and
   `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/` yourself. Then in the
   Clerk dashboard (open it from the Vercel integration page):
   - Sign-in methods: **Google** and **email verification code** are on by
     default; leave password off as a sign-in method.
   - Restrictions → Allowlist: add your email and enable allowlist-only sign-ups
     (also doable with the Backend API: `POST /v1/allowlist_identifiers`, then
     `PATCH /v1/instance/restrictions {"allowlist":true}`). Google sign-in is
     checked against the same allowlist.
   - Sessions: set the lifetime you want (30 days here).
   - Domains: the app's URL must be listed for the instance.
3. `npm run migrate` — creates tables (idempotent).
4. `npm run backfill` — one year of daily bars, ~55 min on the free tier
   (5 calls/min). Resume-safe; re-run if interrupted. Then `npm run
   seed:indices` for the market strip's ETF history (3 calls), and
   `npm run backfill:scans` to replay the loose screen over the stored history
   so `/research` has something to score on day one (~2 min, no API calls).
   The research jobs themselves run on Vercel after each scan; nothing to
   install for that. For local runs and the Python tests: Python ≥ 3.11
   (`brew install python@3.13`), then `python3.13 -m venv .venv &&
   .venv/bin/pip install -r requirements.txt pytest`.
5. Tap **↻ Run scan for previous day** on the app's Help page (or `npm run scan:now`, which calls `/api/cron/scan?force=1` with
   `CRON_SECRET` injected from Vercel).
6. On iPhone: open the deployed URL in Safari → Share → Add to Home Screen →
   open Scanmana from the icon → sign in once inside it (its cookie jar is
   separate from Safari's) → tap "Enable nightly scan alerts" → tap "Send test
   alert" to see one arrive (`POST /api/push/test` pushes to that device only).

## Commands

All of these inject secrets per-process from Vercel (`vercel env run -e production`).

- `npm run dev` / `npm run build`
- `npm test` — engine unit tests (indicators, Darvas box, screens, market filter, paper engine, tape sizing, research readers and story; 109)
- `.venv/bin/pytest tests/py` — research jobs (outcomes, sweep, clusters, splits, breadth, replay; 37) — `test_sweep.py` also asserts the Python grids match `lib/screen.ts` and `lib/config.ts`
- `npm run migrate` / `npm run backfill [calendarDays]` / `npm run seed:indices` (QQQ/SPY/IWM history, once) / `npm run backfill:scans [-- --days N] [-- --force]` (replay the loose screen into `scan_history`) / `npm run analyze` (recompute analyses for the latest scan)
- `npm run research -- [--jobs a,b] [--force] [--budget S]` — run research jobs locally against the production DB (writes the same derived tables the nightly function writes)
- `npm run scan:now` — needs a readable `CRON_SECRET` (see HANDOFF gotcha 6); otherwise use the in-app button
- Deploy: git-connected since 2026-09-01 — `git push origin main` builds and promotes production automatically (`vercel --prod --yes` still works for an out-of-band deploy)

## Layout

- `lib/` — pure engine (`indicators`, `screen`, `darvas`, `livermore`,
  `market`, `analysis`, `paper-engine`, `tape`), `scan.ts` orchestrator (also writes
  `scan_history` via `scan-history.ts` and applies confirmed split factors), `scan-notify.ts` (scan + push + paper night, shared by
  cron and button), `paper-db.ts` (paper book persistence), `research.ts` (research
  readers + `triggerResearch`), `research-story.ts` (rule-change registry,
  scorecard arithmetic, sweep headline, health line — pure), `massive.ts` API client (retries, pre-EOD fallback),
  `db.ts`, `push.ts`
- `research/` — the Python jobs (`run.py` orders and budgets them; `db.py`,
  `util.py` shared); `api/research_job.py` — the Vercel Python function that
  runs them (`POST /api/research_job?job=a,b&force=1&budget=S`, Bearer
  `CRON_SECRET`); `.python-version`, `requirements.txt`, `vercel.json`
  `functions` block
- `app/` — deck (`/`), `/deck` list, `/watchlist`, `/paper` book, `/research`, `/s/[ticker]` symbol page (same card for
  any symbol; watchlist rows link here), `/help`, `/sign-in`, API routes
  (`cron/scan`, `scan/run`, `scan/live`, `analysis`, `watchlist`,
  `watchlist/live`, `scan/bars`, `push/subscribe`, `push/test`,
  `paper/book|take|sell|stop|trail|order`, `research/deck|run|alias|split`)
- `proxy.ts` — Clerk gate; `lib/auth.ts` — public-path list; `app/sign-in/` — Clerk sign-in page
- `scripts/` — `setup.sh` wizard, `migrate`, `backfill`, `backfill-scans`, `seed-indices`,
  `analyze`, `scan-now.sh`, `gen-icons.py`
- `tests/` — vitest suite with synthetic fixtures; `tests/py/` — pytest suite for the research jobs

Out of scope (v1, deliberate): intraday entries or verdicts (the live reads
are display-only — the scan and its Wait/Pass never change during the day, and
paper fills are decided on daily bars only), parabolic shorts, settings UI,
journaling, multi-user.

## License

MIT — see [LICENSE](LICENSE). Scanmana is an independent hobby project, not
affiliated with or endorsed by any of the traders or publishers whose published
methods it implements.
