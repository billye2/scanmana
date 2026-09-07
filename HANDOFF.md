# HANDOFF — Scanmana (Vercel project `scanmana`, named `rc02` until 2026-08-31)

_Last updated: 2026-09-07. Read this first when picking up the project._

## What this is

**Scanmana**: personal, single-user EOD stock scanner as a mobile-first PWA.
Engine = Qullamaggie breakout screens (momentum leaders in tight
consolidations); Darvas box + Livermore pivot drawn on each chart as
trigger/stop overlays. Full product decisions and thresholds: see README.md
and `lib/config.ts` (thresholds are deliberately hardcoded — no settings UI).

## Current state

| Area | Status |
|---|---|
| Engine + unit tests | ✅ 46/46 passing (`npm test`) |
| Production deploy | ✅ https://scanmana.vercel.app (Vercel project `scanmana`) |
| Neon DB (Scanmana's own) | ✅ Neon via Vercel Marketplace, env `COIL_DATABASE_URL`, schema migrated (tables: bars, tickers, scan_results, analyses, watchlist, push_subscriptions, quotes; `npm run migrate` is idempotent) |
| Cron | ✅ `/api/cron/scan` at `0 4 * * 2-6` UTC (midnight EDT / 11pm EST) + catch-up `30 5 * * 2-6` (1:30am EDT; skips if already scanned). Massive publishes the day's grouped bars after 9:30pm ET, so the first run must wait until at least midnight, auth via `CRON_SECRET` |
| Push | ✅ VAPID keys set on Vercel prod; iOS flow in `components/PushSetup.tsx` |
| Access | ✅ Clerk email-code sign-in (`proxy.ts` = `clerkMiddleware`, `/sign-in` page, `ClerkProvider` in the root layout; since 2026-09-07). Only allowlisted emails can sign in (Clerk dashboard → Restrictions, sign-ups restricted); sessions 30 days (dashboard → Sessions); sign-out link in the `/help` footer. Public: `/api/cron/*` (own secret), manifest, sw.js, icons, `/sign-in`. Unauthenticated `/api/*` → 401 JSON; pages → `/sign-in` and back. |
| PWA assets | ✅ mobile-first, full-window layout at ≥1024px (Tailwind `lg:`); manifest, sw.js, icons all serve 200 on prod; `/help` explains badges + overlays and charts QQQ/SPY/IWM with 10/20/50 SMAs; `/s/[ticker]` symbol page (watchlist rows link to it; builds the card from stored bars when the symbol isn't in tonight's deck) + **Scan fit** checklist (`explainScreen`, `components/ScreenFit.tsx`; includes an informational Minervini-VCP block via `explainVcp` — analysis lens, never decides deck membership); `/s` free-form lookup page (search icon in the header, `components/SymbolLookup.tsx`); **Live** watchlist section on `/watchlist` (`components/LiveWatch.tsx` → `GET /api/watchlist/live` → `lib/livewatch.ts`; buckets breaking/failed/stopped/approaching/quiet, polls 60s while visible, 60s shared TTL in market hours / 30-min off-hours); **Live** toggle on `/s/[ticker]` (`?live=1`, `lib/intraday.ts`: Finnhub free quotes for symbol + QQQ/SPY/IWM, 30-min shared cache in the `quotes` Neon table — global TTL across users/instances, provisional today-bar with volume assumed at the 20-day avg, market filter recomputed live; missing key/errors fall back to EOD with a note) — read-only, never changes the scan |
| Market data | ✅ `MASSIVE_API_KEY` on Vercel; backfill done 2026-09-01 (1.32M bars, 251 dates, 5,692 tickers) |
| First scan | ✅ 2026-09-01 via **↻ Run scan** (now labelled **Run scan for previous day**; `POST /api/scan/run`): date 2026-08-31, 60 setups (40 boxed, ranked first; parabolic guard added 2026-09-01 — ADR ≤ 15%, 1M ≤ +300%, ≥ $5 on every close of the last 21 sessions) |
| Analysis | ✅ rule-based Kullamägi/Livermore/Darvas/Minervini-VCP read per candidate (`lib/analysis.ts`, VCP geometry in `lib/minervini.ts`; analyses stored before 2026-09-01 lack the minervini field — UI guards), stored in `analyses` at scan time; **Analysis (Wait/Pass)** button under the symbol (no Take verdict — EOD can't justify an entry, dropped 2026-09-01) (verdict stamped on each payload candidate); **list** icon in the header (next to ★) lists the whole deck with verdict chips + tally, tap a row to jump (`components/DeckList.tsx`, mounted via portal from `Deck`); 2026-08-31 (after VCP framework, 2026-09-01 recompute): 33 wait / 27 pass |
| Market strip | ✅ Kullamägi index filter (QQQ/SPY 10>20, price > 20/50, 10/20/50 rising → Bullish, else Not bullish); ETF bars seeded via `npm run seed:indices`, kept current by the scan |

## Next step (user-driven)

Everything runs on its own now. Remaining checks: confirm the nightly push
lands on the iPhone after the next cron (Mon–Fri ~midnight ET, catch-up ~1:30am
ET), and eyeball the deck quality (60 setups on the first scan may be loose —
thresholds live in `lib/config.ts`). Manual rescan: **↻ Run scan for previous day** in the app
header (`POST /api/scan/run`, no secret, never forces) or `npm run scan:now`
(secret path, `force=1`).

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
   the header itself.

## Ship recipe

Versioning (taskmana-mobile scheme): segments count 0–9 (`1.0.9` → `1.1.0`).
`npm run bump` advances `package.json` and the `/help` footer line
(`lib/version.ts`) together; the release commit title carries `(x.y.z)`.
No git tags; no sw cache key here (the service worker precaches nothing).
Baseline `1.0.0` stamped 2026-09-02.

Git-connected to `github.com/billye2/scanmana` (public since 2026-09-07) since 2026-09-01, no CI:
`npm run lint && npm test && npx tsc --noEmit`, commit, `git push` — the push
to `main` builds and promotes production on its own. `vercel --prod --yes`
still works for an out-of-band deploy of the working tree.
Confirm with `vercel ls --prod` → newest is Ready, and curl the prod URL.
`/ship-pwa` does all of this.

## Secrets

- **Secrets live only in Vercel env vars** (global rule in `~/.claude/CLAUDE.md`). `.env.local` holds public VAPID values only. Local commands (`npm run dev|migrate|backfill|scan:now`) inject secrets per-process via `vercel env run -e production` — never `vercel env pull`.
- Vercel prod env: `CRON_SECRET`, `VAPID_*`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
  `COIL_*` (Neon), `MASSIVE_API_KEY`, `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Clerk via Vercel Marketplace, resource `scanmana-auth`, 2026-09-07) + `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`,
  `FINNHUB_API_KEY` (Live mode on `/s/[ticker]`, added 2026-09-02), `VAPID_SUBJECT` (mailto: contact for push; required since 2026-09-07).

## Conventions

- `mistakes.md`: every fixed mistake gets an entry in the same change.
- Free-tier limits shape the design: Massive Basic = 5 calls/min, EOD-only →
  grouped-daily endpoint (whole market, 1 call/day), nightly cron, 400-day
  bar retention (`CONFIG.PRUNE_DAYS`).

## Out of scope (v1, deliberate)

Intraday anything, real-time data, parabolic shorts, settings UI, journaling,
multi-user/auth, TradingView integration.
