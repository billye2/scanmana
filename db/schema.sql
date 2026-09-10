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
  status text NOT NULL DEFAULT 'armed' CHECK (status IN ('armed', 'armed_late', 'filled', 'cancelled')),
  source text NOT NULL CHECK (source IN ('auto', 'take')),
  armed_date date NOT NULL,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS paper_orders_live_idx ON paper_orders (user_id, track, ticker) WHERE status IN ('armed', 'armed_late');

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
