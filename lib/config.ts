// All screen thresholds live here (deliberately hardcoded — no settings UI).
// Numbers follow Qullamaggie's published defaults, except the price and
// dollar-volume floors, which sit above his ($5 / $1M) to keep penny stocks and
// thinly traded names out of the deck (raised 2026-09-08).

// Parabolic guard, shared by the screen (hard filter) and the analysis (verdict).
// A stock above these is in the vertical leg of a spike, not a swing setup.
const PARABOLIC = {
  MAX_ADR_PCT: 15, // avg daily range above this = not tradeable with a sane stop
  MAX_RET_1M: 3.0, // +300% in 21 sessions = no base underneath
  MIN_PRICE_WINDOW: 21, // every close in this window must be >= MIN_PRICE (no sub-$10 shells)
} as const;

export const CONFIG = {
  // Universe hard filters
  MIN_PRICE: 10,
  MIN_DOLLAR_VOLUME: 20_000_000, // 20-day avg of close * volume

  // Momentum qualifier — ANY of these passes
  MOMENTUM: { M1: 0.25, M3: 0.5, M6: 1.0 },
  LOOKBACK: { M1: 21, M3: 63, M6: 126 }, // trading days

  // Volatility / trend / structure
  MIN_ADR_PCT: 3.5,
  ...PARABOLIC,
  ADR_WINDOW: 20,
  SMA_FAST: 10,
  SMA_SLOW: 20,
  SMA_SLOPE_LOOKBACK: 5, // "rising" = SMA now > SMA 5 sessions ago
  MAX_DIST_FROM_HIGH: 0.15, // within 15% of 6-month high
  HIGH_LOOKBACK: 126,

  // Watchlist cap: 20 fits inside LIVE.WATCH_BUDGET, so every watched name
  // refreshes on every poll.
  WATCHLIST_CAP: 20,

  // Live quotes (Finnhub free tier: 60 calls/min, 30/sec). Each poll refetches at
  // most BUDGET stale symbols, oldest first, and serves the rest from the shared
  // cache with their age — so deck (30) + watchlist (25) + one /s lookup (4)
  // stay under the minute even with every page open. A 60-name deck refreshes
  // fully every 2 polls; smaller decks every poll. BATCH bounds concurrency.
  LIVE: { APPROACH_PCT: 0.02, DECK_BUDGET: 30, WATCH_BUDGET: 25, BATCH: 10 },

  // Ranking: candidates with a Darvas box first (something to trade), then tightest first
  TIGHTNESS_WINDOW: 10, // (10-day range %) / ADR% — lower = tighter
  MAX_RESULTS: 60,

  // Episodic pivot badge
  EP: { LOOKBACK: 5, MIN_GAP: 0.1, VOL_MULT: 3, VOL_WINDOW: 20 },

  // Overlay detection
  DARVAS: { confirm: 3, maxWindow: 60, maxHeightPct: 0.35 },
  PIVOT: { width: 3, lookback: 126 },

  // Minervini VCP read (lib/minervini.ts): successive pullbacks in the base,
  // each shallower than the last, tightest at the right edge.
  VCP: {
    BASE_LOOKBACK: 60, // sessions that count as "the base"
    SWING_WIDTH: 2, // swing high = higher than 2 bars on each side
    MIN_CONTRACTIONS: 2, // Minervini: typically 2–4 T-waves
    MAX_FINAL_PCT: 0.1, // final contraction deeper than 10% = not tight yet
  },

  // Market health (Kullamägi: trade breakouts when the indexes sit above rising
  // 10/20-day averages; step back when they're below the 20-day). Verdict is
  // computed from LEADERS; the rest are shown for context.
  MARKET: {
    INDICES: ["QQQ", "SPY", "IWM"],
    LEADERS: ["QQQ", "SPY"],
    SMAS: [10, 20, 50],
    SLOPE_LOOKBACK: 5,
  },

  // Per-candidate analysis (lib/analysis.ts) — what each framework considers disqualifying
  ANALYSIS: {
    MAX_ADR_PCT: PARABOLIC.MAX_ADR_PCT,
    MAX_RET_1M: PARABOLIC.MAX_RET_1M,
    MIN_REST_DAYS: 10, // Kullamägi: 2–8 weeks of consolidation before the break
    MAX_REST_DAYS: 40,
    MAX_BOX_RISK: 0.15, // Darvas box taller than this = stop too far
    CHASE_PCT: 0.05, // Livermore: more than this above the pivot = chasing
    VOL_DRYUP: 0.7, // 5-day avg volume / 20-day avg below this = drying up
    SPIKE_LOOKBACK: 40, // sessions to look back for the last EP-style gap
  },

  // Data requirements
  MIN_BARS: 127, // 6-month return needs 126 bars of history + today
  CHART_BARS: 130, // bars embedded in the scan payload per candidate
  PRUNE_DAYS: 400, // calendar days of bars kept in the DB
} as const;
