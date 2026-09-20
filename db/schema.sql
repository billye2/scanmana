CREATE TABLE IF NOT EXISTS bars (
  ticker text NOT NULL,
  date date NOT NULL,
  o double precision NOT NULL,
  h double precision NOT NULL,
  l double precision NOT NULL,
  c double precision NOT NULL,
  v bigint NOT NULL,
  PRIMARY KEY (ticker, date)
);

CREATE INDEX IF NOT EXISTS bars_date_idx ON bars (date);

CREATE TABLE IF NOT EXISTS tickers (
  ticker text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scan_results (
  date date PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist (
  ticker text PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now(),
  box_top double precision,
  box_bottom double precision
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint text PRIMARY KEY,
  keys jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analyses (
  date date NOT NULL,
  ticker text NOT NULL,
  analysis jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, ticker)
);

CREATE TABLE IF NOT EXISTS quotes (
  symbol text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Paper trading (lib/paper-engine.ts, lib/paper-db.ts). Keyed by Clerk user id.
-- Plain statements only: scripts/migrate.ts splits this file on semicolons.
CREATE TABLE IF NOT EXISTS paper_accounts (
  user_id text NOT NULL,
  track text NOT NULL CHECK (track IN ('auto', 'manual')),
  cash double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track)
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  track text NOT NULL CHECK (track IN ('auto', 'manual')),
  ticker text NOT NULL,
  trigger_price double precision NOT NULL,
  stop_price double precision NOT NULL,
  kind text NOT NULL DEFAULT 'buy_stop' CHECK (kind IN ('buy_stop', 'market')),
  status text NOT NULL DEFAULT 'armed' CHECK (status IN ('armed', 'filled', 'cancelled')),
  late boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('auto', 'take')),
  armed_date date NOT NULL,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'buy_stop' CHECK (kind IN ('buy_stop', 'market'));

ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS late boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS paper_orders_live_idx ON paper_orders (user_id, track, ticker) WHERE status = 'armed';

CREATE TABLE IF NOT EXISTS paper_positions (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  track text NOT NULL CHECK (track IN ('auto', 'manual')),
  ticker text NOT NULL,
  order_id bigint REFERENCES paper_orders (id),
  entry_date date NOT NULL,
  entry_price double precision NOT NULL,
  shares integer NOT NULL,
  initial_stop double precision NOT NULL,
  current_stop double precision NOT NULL,
  trail_mode text NOT NULL DEFAULT 'none' CHECK (trail_mode IN ('none', 'percent', 'lowestlow')),
  trail_param double precision,
  pending_sell_shares integer,
  peak_close double precision NOT NULL,
  mfe double precision NOT NULL,
  mae double precision NOT NULL,
  late boolean NOT NULL DEFAULT false,
  split_flagged boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS paper_positions_open_idx ON paper_positions (user_id, track, ticker) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS paper_positions_user_idx ON paper_positions (user_id, track, status);

CREATE TABLE IF NOT EXISTS paper_exits (
  id bigserial PRIMARY KEY,
  position_id bigint NOT NULL REFERENCES paper_positions (id),
  exit_date date NOT NULL,
  exit_price double precision NOT NULL,
  shares integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('stop', 'manual_sell')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_exits_position_idx ON paper_exits (position_id);

CREATE TABLE IF NOT EXISTS paper_skips (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  track text NOT NULL CHECK (track IN ('auto', 'manual')),
  ticker text NOT NULL,
  date date NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_processed_dates (
  user_id text NOT NULL,
  date date NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

-- Research layer (research/*.py on Vercel, read by lib/research.ts). The scan
-- writes scan_history, every research_* table is derived and safe to truncate.
-- No semicolons inside comments: scripts/migrate.ts splits this file on them.

-- One row per (date, ticker) that passed the LOOSE screen (lib/screen.ts
-- LOOSE_LIMITS). base_pass marks the real screen, rank is the deck position
-- (null when not in the capped deck). Written by lib/scan.ts nightly and by
-- scripts/backfill-scans.ts for history.
CREATE TABLE IF NOT EXISTS scan_history (
  date date NOT NULL,
  ticker text NOT NULL,
  base_pass boolean NOT NULL,
  rank smallint,
  verdict text NOT NULL CHECK (verdict IN ('wait', 'pass')),
  objections text[] NOT NULL DEFAULT '{}',
  close double precision NOT NULL,
  dollar_vol double precision NOT NULL,
  adr_pct double precision NOT NULL,
  dist_from_high double precision NOT NULL,
  ret_1m double precision NOT NULL,
  ret_3m double precision NOT NULL,
  ret_6m double precision NOT NULL,
  tightness double precision NOT NULL,
  boxed boolean NOT NULL,
  box_top double precision,
  box_bottom double precision,
  pivot double precision,
  ep boolean NOT NULL DEFAULT false,
  vcp boolean NOT NULL DEFAULT false,
  market_bullish boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, ticker)
);

CREATE INDEX IF NOT EXISTS scan_history_ticker_idx ON scan_history (ticker, date);

CREATE TABLE IF NOT EXISTS research_outcomes (
  date date NOT NULL,
  ticker text NOT NULL,
  level double precision,
  broke_10d boolean,
  broke_day smallint,
  mfe_5 double precision, mfe_10 double precision, mfe_20 double precision,
  mae_5 double precision, mae_10 double precision, mae_20 double precision,
  r_at_exit double precision,
  filled boolean,
  sessions_after smallint NOT NULL,
  complete boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, ticker)
);

CREATE TABLE IF NOT EXISTS research_sweep (
  param text NOT NULL,
  value double precision NOT NULL,
  deck_size double precision NOT NULL,
  hit_rate double precision,
  avg_r double precision,
  n integer NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  as_of date NOT NULL,
  PRIMARY KEY (param, value)
);

CREATE TABLE IF NOT EXISTS research_clusters (
  cluster_id integer NOT NULL,
  cluster_key text NOT NULL,
  leaders text[] NOT NULL,
  members text[] NOT NULL,
  member_count integer NOT NULL,
  ret_63d double precision NOT NULL,
  as_of date NOT NULL,
  PRIMARY KEY (cluster_id)
);

CREATE TABLE IF NOT EXISTS research_cluster_members (
  ticker text PRIMARY KEY,
  cluster_id integer NOT NULL
);

CREATE TABLE IF NOT EXISTS research_cluster_alias (
  cluster_key text PRIMARY KEY,
  alias text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_splits (
  ticker text NOT NULL,
  date date NOT NULL,
  ratio double precision NOT NULL,
  gap_pct double precision NOT NULL,
  vol_ratio double precision,
  confidence double precision NOT NULL,
  status text NOT NULL CHECK (status IN ('auto', 'review', 'ignored')),
  factor double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, date)
);

CREATE TABLE IF NOT EXISTS research_breadth (
  date date PRIMARY KEY,
  universe integer NOT NULL,
  pct_above_20 double precision NOT NULL,
  pct_above_50 double precision,
  pct_10_over_20 double precision NOT NULL,
  new_highs integer NOT NULL,
  new_lows integer NOT NULL
);

CREATE TABLE IF NOT EXISTS research_replay (
  track text NOT NULL,
  rule text NOT NULL,
  label text NOT NULL,
  avg_r double precision,
  win_rate double precision,
  max_dd double precision,
  avg_hold double precision,
  total_pnl double precision,
  trades integer NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  as_of date NOT NULL,
  PRIMARY KEY (track, rule)
);

CREATE TABLE IF NOT EXISTS research_runs (
  job text PRIMARY KEY,
  scan_date date,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  ok boolean,
  note text
);
