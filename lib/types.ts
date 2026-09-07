export interface Bar {
  date: string; // YYYY-MM-DD
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface DarvasBox {
  top: number;
  bottom: number;
  startDate: string;
  confirmed: boolean;
}

export interface EpSignal {
  date: string;
  gapPct: number;
  volMult: number;
}

export interface Candidate {
  ticker: string;
  name: string;
  price: number;
  dollarVol: number;
  ret1m: number;
  ret3m: number;
  ret6m: number;
  adrPct: number;
  distFromHigh: number;
  tightness: number;
  box: DarvasBox | null;
  pivot: number | null;
  ep: EpSignal | null;
  bars: Bar[]; // trailing daily bars for charting
  verdict?: Verdict; // overall analysis verdict, stamped at scan time (lib/analysis.ts)
}

export interface WatchlistAlert {
  ticker: string;
  boxTop: number;
  close: number;
  high: number;
}

export interface IndexSma {
  period: number;
  value: number;
  above: boolean; // close > sma
  rising: boolean; // sma > sma SLOPE_LOOKBACK sessions ago
}

export interface IndexHealth {
  ticker: string;
  close: number;
  smas: IndexSma[];
  fastOverSlow: boolean; // 10-day SMA above 20-day SMA — Kullamägi's market filter
}

export type MarketVerdict = "bullish" | "not-bullish";

export interface MarketHealth {
  verdict: MarketVerdict;
  reason: string;
  indices: IndexHealth[];
}

export interface ScanPayload {
  date: string;
  generatedAt: string;
  candidates: Candidate[];
  watchlistAlerts: WatchlistAlert[];
  market?: MarketHealth; // absent on scans before market health existed
}

export type Verdict = "wait" | "pass"; // no "take": EOD data can never justify an entry — the earliest action is tomorrow's open

export interface FrameworkView {
  verdict: Verdict;
  points: string[]; // short, concrete sentences in the order they were checked
}

export interface Analysis {
  ticker: string;
  date: string; // scan date
  overall: Verdict;
  summary: string; // one line
  plan: string | null; // "Buy the break of $X · stop $Y · risk Z%" when a trade exists
  qullamaggie: FrameworkView;
  livermore: FrameworkView;
  darvas: FrameworkView;
  minervini?: FrameworkView; // VCP; optional — analyses stored before 2026-09-01 lack it
}
