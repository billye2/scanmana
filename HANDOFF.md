# HANDOFF — Scanmana (Vercel project `scanmana`, named `rc02` until 2026-08-31)

_Last updated: 2026-09-20 (1.3.2). Read this first when picking up the project._

## What this is

**Scanmana**: personal, single-user EOD stock scanner as a mobile-first PWA.
Engine = Qullamaggie breakout screens (momentum leaders in tight
consolidations); Darvas box + Livermore pivot drawn on each chart as
trigger/stop overlays. A Python research layer scores the scanner's own history
nightly (`/research`); rule changes are made from its numbers and logged in the
config comment, the commit and here. Full product decisions and thresholds: see
README.md and `lib/config.ts` (thresholds are deliberately hardcoded — no settings UI).

## Current state

| Area | Status |
|---|---|
| Engine + unit tests | ✅ 95/95 vitest (`npm test`) + 36/36 pytest (`.venv/bin/pytest tests/py`, needs the Python ≥ 3.11 `.venv` — system python on the Mac is 3.9) |
| Production deploy | ✅ https://scanmana.vercel.app (Vercel project `scanmana`) |
| Neon DB (Scanmana's own) | ✅ Neon via Vercel Marketplace, env `COIL_DATABASE_URL`, schema migrated (tables: bars, tickers, scan_results, analyses, watchlist, push_subscriptions, quotes, paper_*, scan_history, research_* — every `research_*` table is derived and safe to truncate; `npm run migrate` is idempotent; no `;` inside comments in `db/schema.sql`, the migrator splits on them) |
| Cron | ✅ `/api/cron/scan` at `0 4 * * 2-6` UTC (midnight EDT / 11pm EST) + catch-up `30 5 * * 2-6` (1:30am EDT; skips if already scanned). Massive publishes the day's grouped bars after 9:30pm ET, so the first run must wait until at least midnight, auth via `CRON_SECRET`. The scan route chains the Python research job with `after()` (`lib/research.ts` `triggerResearch` → `POST /api/research_job`, same `CRON_SECRET`); jobs skip when already current for the latest scan date, so the 05:30 catch-up (scan "skipped") is where they normally get the full 280 s budget. Still only two crons (Hobby limit) |
| Push | ✅ VAPID keys set on Vercel prod; iOS flow in `components/PushSetup.tsx` — every step reports on screen, subscribed devices get **Send test alert** (`POST /api/push/test`, that device only); verified on the iPhone 2026-09-09 (Apple endpoint in `push_subscriptions` beside the desktop-Chrome one) |
| Access | ✅ Clerk sign-in — Google or email code, no password (`proxy.ts` = `clerkMiddleware`, `/sign-in` page, `ClerkProvider` in the root layout; since 2026-09-07). Only allowlisted emails can sign in (Clerk dashboard → Restrictions, sign-ups restricted); sessions 30 days (dashboard → Sessions); sign-out link in the `/help` footer. Public: `/api/cron/*` (own secret), manifest, sw.js, icons, `/sign-in`. Unauthenticated `/api/*` → 401 JSON; pages → `/sign-in` and back. |
| PWA assets | ✅ mobile-first, full-window layout at ≥1024px (Tailwind `lg:`); manifest, sw.js, icons all serve 200 on prod; `/help` explains badges + overlays and charts QQQ/SPY/IWM with 10/20/50 SMAs; `/s/[ticker]` symbol page (watchlist rows link to it; builds the card from stored bars when the symbol isn't in tonight's deck) + **Scan fit** checklist (`explainScreen`, `components/ScreenFit.tsx`; includes an informational Minervini-VCP block via `explainVcp` — analysis lens, never decides deck membership); `/s` free-form lookup page (search icon in the header, `components/SymbolLookup.tsx`); **Live** watchlist section on `/watchlist` (`components/LiveWatch.tsx` → `GET /api/watchlist/live` → `lib/livewatch.ts`; buckets breaking/failed/stopped/approaching/quiet, polls 60s while visible, 60s shared TTL in market hours / 30-min off-hours); **Live** toggle on `/s/[ticker]` (`?live=1`, `lib/intraday.ts`: Finnhub free quotes for symbol + QQQ/SPY/IWM, 30-min shared cache in the `quotes` Neon table — global TTL across users/instances, provisional today-bar with volume assumed at the 20-day avg, market filter recomputed live; missing key/errors fall back to EOD with a note); **Live deck** (since 2026-09-08): `Deck` polls `GET /api/scan/live` → `deckLive()` in `lib/livewatch.ts`, chip + live price on each card, list overlay **Live** toggle groups by bucket. Finnhub budget: `getQuotes(symbols, ttl, { maxFetch })` refetches the oldest stale symbols first up to `CONFIG.LIVE` (deck 30 + watchlist 25 + a /s lookup 4 < 60/min), batches of 10, per-symbol `allSettled`, a 429 halts the refresh and serves stale rows with `ageSec` — read-only, never changes the scan |
| Market data | ✅ `MASSIVE_API_KEY` on Vercel; backfill done 2026-09-01 (1.32M bars, 251 dates, 5,692 tickers) |
| First scan | ✅ 2026-09-01 via **↻ Run scan** (now labelled **Run scan for previous day**; `POST /api/scan/run`): date 2026-08-31, 60 setups (40 boxed, ranked first; parabolic guard added 2026-09-01 — ADR ≤ 15%, 1M ≤ +300%, ≥ $5 on every close of the last 21 sessions) |
| Analysis | ✅ rule-based Kullamägi/Livermore/Darvas/Minervini-VCP read per candidate (`lib/analysis.ts`, VCP geometry in `lib/minervini.ts`; analyses stored before 2026-09-01 lack the minervini field — UI guards), stored in `analyses` at scan time; **Analysis (Wait/Pass)** button under the symbol (no Take verdict — EOD can't justify an entry, dropped 2026-09-01) (verdict stamped on each payload candidate). **Verdict = worst of Kullamägi, Darvas and Minervini since 1.3.0 (2026-09-20)** — Livermore's read stays on the card but does not veto (measured: his solo "chasing" veto had removed the best-performing cards); his objection is still recorded in `scan_history.objections`, so `/research` keeps scoring him; **list** icon in the header (and **Deck** in the bottom bar) opens `/deck` — a page (not a popup, Billy's call 2026-09-08) listing the whole deck with verdict chips + tally and a **Live** toggle that groups by bucket (`components/DeckLiveList.tsx`); tap a row → `/?i=N` opens that card; 2026-08-31 (after VCP framework, 2026-09-01 recompute): 33 wait / 27 pass |
| Paper trading | ✅ (since 2026-09-10) `/paper` (briefcase icon, top nav + bottom bar): two ledgers priced on the stored EOD bars, keyed by Clerk user id. **auto** = every boxed Wait card armed nightly as a buy-stop at the box top / stop at the box bottom, no cash cap, stop trails the 10-session low; **manual** = $10k, cash binds, **Take** on a deck card or watchlist row (**Take at open** = market buy at the next open when price is already above the trigger; the auto book does the same on breakout day — `paper_orders.kind` buy_stop|market), raise-only stop, optional percent / N-session-low trail, partial sells at the next open, **Remove** on an armed manual order (`DELETE /api/paper/order`). Engine is pure (`lib/paper-engine.ts`, 18 tests); `lib/paper-db.ts` runs it from `scanAndNotify` right after the scan persists (`runPaperNight`: every unprocessed bar date since the user's last one, then arm from tonight's payload; `paper_processed_dates` makes a forced rescan a no-op; a paper failure is logged and never blocks the push). Tables: paper_accounts, paper_orders, paper_positions, paper_exits, paper_skips, paper_processed_dates (`npm run migrate`). The nightly job serves only users with a `paper_accounts` row, created on the first visit to `/paper` — so the ledger starts the night after that visit. Push line: `Paper: N filled, M stopped, K armed[ · half size]`. **Size by the tape since 1.3.2 (2026-09-20)**: `lib/tape.ts` scales the $500 notional at fill time — full when the index filter is Bullish and breadth ≥ 50%, half with one signal, quarter with none, an unknown signal left out; breadth is the prior session's (the research job writes tonight's after the book runs). Shown in the market strip, under the paper stats (with the reason) and in the push when not full. Sizing changes dollars, not R, so win rate / expectancy do not move with it — the equity curve does. |
| Research layer | ✅ (2026-09-20, 1.2.9; fixes and first rule changes through 1.3.2) Python jobs in `research/` (outcomes, sweep, clusters, splits, breadth, replay) behind `api/research_job.py` (Vercel Python 3.13 function, `.python-version` + `requirements.txt`, `vercel.json` functions block); `lib/research.ts` readers + `triggerResearch`; the cron route chains the job after the scan via `after()`; `/research` page (flask icon), per-card "Setups like this" + Theme lines on the deck (`GET /api/research/deck`), breadth line in the market strip, replay line on `/paper`, Help section. Input table `scan_history` written nightly by `lib/scan.ts` (loose screen, `screenBoth`) and backfilled once via `npm run backfill:scans` (149 sessions). Verified 2026-09-20: pytest 36 green (`.venv/bin/pytest tests/py`, Homebrew python3.13), tsc/lint/vitest green (87), all six jobs ran on a preview and locally against the prod DB (21,240 outcome rows, 29 sweep points, 65 clusters, 46 split candidates / 9 auto, 212 breadth dates, 1 replayed trade), `/research` rendered offline with real data (14 charts, no NaN), 50/51 deck cards get a like-this line and 30 a theme. Billy opened `/research` on production 2026-09-20. Findings so far are in the Next step section. |
| Market strip | ✅ Kullamägi index filter (QQQ/SPY 10>20, price > 20/50, 10/20/50 rising → Bullish, else Not bullish); ETF bars seeded via `npm run seed:indices`, kept current by the scan. Second line since 1.2.9: breadth (`research_breadth`, % above 20d / 50d, new highs / lows, amber "narrow tape" when Bullish under 40%) and the paper size the tape implies (1.3.2) |

## Next step (user-driven)

**First unattended night of the whole stack is 2026-09-21 (Monday's scan, 04:00 UTC; the 05:30 catch-up gives the research job its full budget).** Shipped 2026-09-20 without a live night yet: research layer (1.2.9), Livermore out of the composite verdict (1.3.0), deck-mate links (1.3.1), 5% distance limit + tape-sized paper orders (1.3.2). Check Tuesday morning:

1. `/research` job log: six rows, all OK, dated 2026-09-21 (`research_runs`). If any is missing, `npm run research -- --jobs <job> --force` reruns it locally with the same code.
2. Home: the deck is smaller (expect ~45–50 instead of ~55 — the 5% limit) with more Wait cards (Livermore no longer vetoes); each card has the "Setups like this" line and, where it applies, "Moves with …" with linked tickers; the market strip has the breadth line and a paper size.
3. `/paper`: Auto armed the boxed Wait cards; the size line under the stats matches the market strip; the push carried `Paper: … armed` and, if the tape was not both signals on, `· half size` / `· quarter size`.

Then, at your pace: approve or ignore the `/research` split review list (top rows are the ambiguous ones; `auto` rows rescale the scan's bars, `ignored` rows are never re-flagged); name a few themes (cluster alias); after a month, look at whether the 5% limit's 70% hit rate held out of sample (the sweep marks the current setting) and whether tape sizing moved the equity curve.

**What the data said on 2026-09-20 (149 sessions, one weak tape, all in-sample):** the 10-day breakout rate was 63% for the whole deck; within 5% of the high 70% vs 53% further out (the only screen floor that moved it more than three points); Minervini agreement 67% vs 59%, Darvas 65% vs 56%, Livermore 62% vs 66%; the EP badge 42% (those names already gapped); average R on the box-top-buy / 10-low trail +0.11 when Bullish vs −0.11 when not, the only cut that flips R positive. Anything else picked from that table will look worse out of sample — one change at a time, let the page score it.

**Deferred:** a Live overlay on `/paper` (Finnhub budget is at 59/60 per minute already); an equity-curve chart (data in `GET /api/paper/book` → `stats.equityCurve`); stats split by which framework said Wait (the raw material is `scan_history.objections` × `research_outcomes`).

**Research notes:** the Python function is at `/api/research_job` (public path in `lib/auth.ts`, checks `CRON_SECRET` itself; previews have no `CRON_SECRET` and rely on deployment protection — `vercel curl <preview-url>/api/research_job?job=breadth -- -X POST` bypasses it); `research/run.py` orders the jobs (outcomes → breadth → splits → clusters → sweep → replay) inside one time budget; the sweep grid's loosest values must equal `LOOSE_LIMITS` in `lib/screen.ts` and its `CURRENT` must equal `lib/config.ts` (`tests/py/test_sweep.py` asserts both, so a config change fails the Python tests until `research/sweep.py` follows); the outcome level is the box top, else the pivot while still overhead, else the 20-session high; `scan_history` is the only input table the scan writes, every `research_*` table can be truncated and rebuilt with `--force`.

Note: holidays return 0 bars and aren't stored, so every `npm run backfill`
re-fetches ~10 holiday dates (~2 min) before finding nothing new — harmless.

## Infra gotchas — read before touching Vercel or the DB

1. **The Vercel project (now `scanmana`, was `rc02` until 2026-08-31) predates
   Scanmana** and still carries env vars from an earlier, unrelated app
   (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`). Scanmana
   reads `COIL_DATABASE_URL` only (`lib/db.ts` enforces). Do not read, write,
   or delete the others. Older deployments still exist at their immutable URLs.
2. **`COIL_` env prefix is intentional legacy** (app was briefly named Coil).
   Don't rename without re-provisioning the integration.
3. **Sign-in and iOS**: the home-screen app has its own cookie jar — sign in
   once inside it, not just in Safari. `npm run scan:now` and the cron hit
   `/api/cron/scan`, which bypasses the gate (it checks `CRON_SECRET` itself).
4. **Clerk runs as a development instance on purpose.** Clerk production keys
   cannot be used on a `*.vercel.app` domain (they need DNS records on a domain
   you own), so `scanmana.vercel.app` uses `pk_test_`/`sk_test_` keys. Clerk's
   UI shows a "Development mode" badge and Clerk does not support dev instances
   for production use; fine for one person. To upgrade: buy a domain, attach it
   to the Vercel project, create a Clerk production instance, swap the keys.
5. **`CRON_SECRET` and `VAPID_PRIVATE_KEY` are marked Sensitive on Vercel** —
   write-only, so `vercel env run` / `env pull` cannot read them. `npm run
   scan:now` explains the two workarounds (dashboard Cron → Run, or recreate
   `CRON_SECRET` as non-sensitive). Nightly cron is unaffected — Vercel injects
   the header itself, and the scan route forwards it to the research function.
6. **The Python function shares the project, not the runtime.** `api/research_job.py`
   is a separate Vercel function (Python 3.13 from `.python-version`, deps from
   `requirements.txt`, 300 s / 2 GB from `vercel.json`); it reads `COIL_DATABASE_URL`
   through psycopg and never imports the Next.js code. The numbers it must agree
   with (`LOOSE_LIMITS`, `CONFIG` floors, the trail lookback) are duplicated as
   constants and pinned by `tests/py`. The local `.venv` is git-ignored.

## Ship recipe

Versioning (taskmana-mobile scheme): segments count 0–9 (`1.0.9` → `1.1.0`).
`npm run bump` advances `package.json` and the `/help` footer line
(`lib/version.ts`) together; the release commit title carries `(x.y.z)`.
No git tags; no sw cache key here (the service worker precaches nothing).
Baseline `1.0.0` stamped 2026-09-02. Run the bump before quoting a version: `1.2.9` rolls to `1.3.0`, not `1.2.10`.

Git-connected to `github.com/billye2/scanmana` (public since 2026-09-07) since 2026-09-01, no CI:
`npm run lint && npm test && npx tsc --noEmit && .venv/bin/pytest tests/py`, commit, `git push` — the push
to `main` builds and promotes production on its own. `vercel --prod --yes`
still works for an out-of-band deploy of the working tree.
Confirm with `vercel ls --prod` → newest is Ready, and curl the prod URL.
`/ship-pwa` does all of this.

## Secrets

- **Secrets live only in Vercel env vars** (global rule in `~/.claude/CLAUDE.md`). `.env.local` holds public VAPID values only. Local commands (`npm run dev|migrate|backfill|backfill:scans|research|scan:now`) inject secrets per-process via `vercel env run -e production` — never `vercel env pull`. `.env.example` is a list of names, not a template to fill in.
- Vercel prod env: `CRON_SECRET`, `VAPID_*`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
  `COIL_*` (Neon), `MASSIVE_API_KEY`, `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Clerk via Vercel Marketplace, resource `scanmana-auth`, 2026-09-07) + `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`,
  `FINNHUB_API_KEY` (Live mode on `/s/[ticker]`, added 2026-09-02), `VAPID_SUBJECT` (mailto: contact for push; required since 2026-09-07).

## Conventions

- `mistakes.md`: every fixed mistake gets an entry in the same change.
- A rule change made from `/research` cites the number in the `lib/config.ts` comment, the commit body and this file, so the next reader can tell a measured setting from an inherited one.
- Free-tier limits shape the design: Massive Basic = 5 calls/min, EOD-only →
  grouped-daily endpoint (whole market, 1 call/day), nightly cron, 400-day
  bar retention (`CONFIG.PRUNE_DAYS`).

## Out of scope (v1, deliberate)

Intraday entries or verdicts (live reads on `/s`, the watchlist and the deck are
display-only; the scan and its Wait/Pass never change during the day; paper fills
are decided on daily bars only), parabolic
shorts, settings UI, journaling, multi-user (sign-in exists, but one allowlisted
account), TradingView integration.
