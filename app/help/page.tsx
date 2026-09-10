import { BriefcaseIcon, ListIcon, SearchIcon } from "@/components/Icons";
import { SignOutButton } from "@clerk/nextjs";
import { APP_VERSION } from "@/lib/version";
import IndexCharts from "@/components/IndexCharts";
import TopNav from "@/components/TopNav";
import RunScanButton from "@/components/RunScanButton";
import { CONFIG } from "@/lib/config";
import { latestScan, loadBars } from "@/lib/scan";
import type { Bar, MarketHealth } from "@/lib/types";

export const metadata = { title: "Help — Scanmana" };
export const dynamic = "force-dynamic";

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-7 mb-2 text-sm font-semibold tracking-wide text-emerald-400 uppercase">{children}</h2>;
}
function Term({ name, who, children }: { name: string; who?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-neutral-100">{name}</span>
        {who && <span className="text-[11px] text-neutral-500">{who}</span>}
      </div>
      <div className="mt-1 text-[13px] leading-relaxed text-neutral-300">{children}</div>
    </div>
  );
}
const Amber = ({ children }: { children: React.ReactNode }) => <span className="font-semibold text-amber-400">{children}</span>;
const Blue = ({ children }: { children: React.ReactNode }) => <span className="font-semibold text-sky-400">{children}</span>;

export default async function Help() {
  const m = CONFIG.MOMENTUM;
  let indexBars = new Map<string, Bar[]>();
  let market: MarketHealth | undefined;
  try {
    const [scan, bars] = await Promise.all([latestScan(), loadBars([...CONFIG.MARKET.INDICES])]);
    market = scan?.market;
    indexBars = bars;
  } catch {
    // DB not configured — the page still renders the text.
  }
  return (
    <main className="mx-auto w-full max-w-xl px-4 lg:max-w-4xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav current="/help" subtitle="Help" />

      <p className="text-[13px] leading-relaxed text-neutral-300">
        Scanmana runs one screen every night after the close: find the market&apos;s strongest stocks, keep only
        the ones resting in a tight range near their highs, and draw the price levels that matter on each chart.
        The screen follows <span className="text-neutral-100">Kristjan Kullamägi</span> (&ldquo;Qullamaggie&rdquo;), a
        Swedish trader who published his breakout rules and numbers around 2019–2021. The chart overlays come from two
        much older sources: Nicolas Darvas (1950s) and Jesse Livermore (1920s–30s).
      </p>
      <div className="mt-3 flex justify-center">
        <RunScanButton />
      </div>

      <H>The badges</H>
      <Term name="1M · 3M · 6M" who="Kullamägi">
        Price change over the last {CONFIG.LOOKBACK.M1}, {CONFIG.LOOKBACK.M3} and {CONFIG.LOOKBACK.M6} trading
        days. A stock qualifies if <em>any one</em> is big enough: +{m.M1 * 100}% in a month, +{m.M3 * 100}% in
        three, or +{m.M6 * 100}% in six. Green = passed on that window. The idea: buy what has already proven it can
        move, not what you hope will.
      </Term>
      <Term name={`ADR — average daily range`} who="Kullamägi">
        The average of (high ÷ low − 1) over the last {CONFIG.ADR_WINDOW} days, in percent. Minimum{" "}
        {CONFIG.MIN_ADR_PCT}%. It measures how much the stock moves on a normal day. You want it high because the
        goal is a 20–50% move in days or weeks, and a stock that moves 1% a day cannot deliver that. It also sizes
        your expectations: an ADR of 6% means a 6% stop is one bad day, not a disaster.
      </Term>
      <Term name="tight" who="Kullamägi (ratio is Scanmana's)">
        The total range of the last {CONFIG.TIGHTNESS_WINDOW} days divided by ADR. Lower is tighter: 3.0 means ten
        days of trading fit inside three ordinary days&apos; worth of movement. The deck is sorted by this — card 1
        is the tightest. Tight ranges after a big run mean sellers are exhausted and holders are sitting still; the
        breakout out of that range is the trade.
      </Term>
      <Term name="EP — episodic pivot" who="Kullamägi">
        A gap up of at least {CONFIG.EP.MIN_GAP * 100}% on {CONFIG.EP.VOL_MULT}× normal volume within the last{" "}
        {CONFIG.EP.LOOKBACK} sessions — usually earnings or news that changes the story. These are bought on the gap
        day itself (the opening range), not after a consolidation, so an EP badge means &ldquo;something just
        happened here&rdquo; rather than &ldquo;wait for the box&rdquo;.
      </Term>
      <Term name="Hard filters you don't see">
        Price ≥ ${CONFIG.MIN_PRICE} on every close of the last {CONFIG.MIN_PRICE_WINDOW} sessions, ≥ $
        {(CONFIG.MIN_DOLLAR_VOLUME / 1e6).toFixed(0)}M traded per day, closing within{" "}
        {CONFIG.MAX_DIST_FROM_HIGH * 100}% of the 6-month high, and both moving averages rising. Anything further
        from its high is &ldquo;extended&rdquo; or broken and is dropped before ranking.
        <span className="mt-1 block">
          <span className="text-neutral-100">Parabolic guard:</span> ADR above {CONFIG.MAX_ADR_PCT}% or more than +
          {CONFIG.MAX_RET_1M * 100}% in a month is rejected — a shell that went from $1 to $18 in three weeks
          passes every floor above on today&apos;s numbers, but it is the vertical leg of a spike, not a setup.
          The deck ranks names with a box first, then by tightness.
        </span>
      </Term>

      <H>The chart lines</H>
      <Term name="Trigger (solid amber)" who="Nicolas Darvas, 1960">
        The top of the <span className="text-neutral-100">Darvas box</span>. Darvas was a touring dancer who made
        $2M in the late 1950s trading by telegram; his book <em>How I Made $2,000,000 in the Stock Market</em>{" "}
        describes stocks moving in &ldquo;boxes&rdquo;. Scanmana finds the most recent high that has capped every
        bar since for at least {CONFIG.DARVAS.confirm} sessions — that ceiling is the box top. A close (or a
        strong intraday move) <em>above</em> it is the buy signal: the stock has left the box upward. The small
        percentage next to it is how far price is below the trigger right now.
      </Term>
      <Term name="Stop (dashed amber)" who="Darvas">
        The bottom of the same box: the lowest low since the box top formed. Darvas&apos;s rule was simple — if the
        stock falls back out of the box, the setup failed, sell. Practically: your risk on the trade is
        trigger − stop. Size the position so that distance equals the dollars you are willing to lose. Boxes taller
        than {CONFIG.DARVAS.maxHeightPct * 100}% are rejected as too loose to trade this way.
      </Term>
      <Term name="Pivot (dotted blue)" who="Jesse Livermore, 1940">
        Livermore&apos;s <span className="text-neutral-100">pivotal point</span>, from <em>How to Trade in Stocks</em>.
        Scanmana uses the highest confirmed swing high of the last 6 months (a bar whose high beats{" "}
        {CONFIG.PIVOT.width} bars on each side). It is the resistance level the whole recent history respects. It
        is only drawn when it differs from the box top; when both are on the chart, a break of the higher one is the
        stronger confirmation. Livermore&apos;s advice was to wait for the pivot to break and then act without
        hesitation — never to buy in anticipation.
      </Term>
      <Term name="Blue and purple lines">
        {CONFIG.SMA_FAST}-day (blue) and {CONFIG.SMA_SLOW}-day (purple) simple moving averages. Kullamägi uses them
        as trailing stops after the breakout: fast movers are sold when they close below the 10-day, slower ones
        below the 20-day.
      </Term>
      <Term name="&ldquo;no box&rdquo;">
        The stock is making fresh highs (nothing above it to break) or its range is too tall. It passed the momentum
        screen but there is no clean level to trade — watch it, don&apos;t chase it.
      </Term>

      <H>
        <span id="market">The market strip</span>
      </H>
      <Term name="Market Bullish · Not bullish" who="Kullamägi">
        Kullamägi&apos;s first rule is that the index decides whether breakouts work at all. His stated filter: while
        the Nasdaq (QQQ) and S&amp;P (SPY) have their <span className="text-neutral-100">10-day average above the
        20-day</span>, breakouts and EPs work; when the 10 crosses under the 20, they fail repeatedly and he steps
        aside. Small caps (IWM) are shown for breadth. Per index the strip shows{" "}
        <span className="font-mono">10&gt;20</span> or <span className="font-mono">10&lt;20</span>, then one ▲/▼ per
        average (10, 20, 50): green ▲ = price above it and rising, amber ▲ = above but flat/falling, red ▼ = below.
        <span className="mt-1 block">
          <span className="text-emerald-300">Bullish</span> — for both QQQ and SPY: 10-day above 20-day, price above
          the 20 and the 50, and all three averages rising. Every one of his conditions is met; trade breakouts at
          full size. A quick dip under the 10-day alone does not change this.{" "}
          <span className="text-red-300">Not bullish</span> — any condition fails; the strip names it. Breakouts
          fail far more often here, so size down or wait for the indexes to reclaim their averages.
        </span>
        {market && (
          <span className="mt-2 block">
            Latest scan: <span className={market.verdict === "bullish" ? "text-emerald-300" : "text-red-300"}>
              {market.verdict === "bullish" ? "Bullish" : "Not bullish"}
            </span>{" "}
            — {market.reason}
          </span>
        )}
        <IndexCharts bars={indexBars} health={market?.indices} />
      </Term>

      <H>How to use the deck</H>
      <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-neutral-300">
        <li>Check the market strip first. Not bullish means the deck is for watching, not buying.</li>
        <li>
          Page through the deck with the ‹ › arrows in the bottom bar after each nightly scan; its <span className="text-neutral-100">Deck</span> button
          opens the whole list as a page, grouped live. Tightest setups come first; most cards are a pass. On a keyboard:{" "}
          <span className="text-neutral-100">←/→</span> or <span className="text-neutral-100">j/k</span> moves through the
          deck (it wraps around), <span className="text-neutral-100">space</span> opens the Google search for the card.
        </li>
        <li>
          The scan runs itself around midnight ET on weeknights (with a 1:30am retry). It always scores the most recent{" "}
          <em>completed</em> session — the data provider publishes a day&apos;s bars only late that evening — which is why
          the deck you open in the morning is dated the previous trading day. If the date on the deck is older than that
          (the scheduled run was missed, or you want the deck before 1:30am), tap{" "}
          <span className="text-neutral-100">↻ Run scan for previous day</span> at the top of this page. It is safe to tap any
          time: it skips if that day is already scanned, and it reports &ldquo;Skipped&rdquo; if the bars are not
          published yet — try again after midnight ET.
        </li>
        <li>
          Tap <span className="text-neutral-100">Analysis</span> under the symbol for a rule-based read of the card through
          all four frameworks — Kullamägi, Livermore, Darvas and Minervini&apos;s VCP (successive contractions, each
          shallower, volume drying up) — Wait / Pass with the reasons, computed from the same numbers at scan time. There is no
          &ldquo;Take&rdquo;: end-of-day data can only tell you what to watch tomorrow, never to buy now.
        </li>
        <li>
          Tap the <span className="text-neutral-100">list</span> icon <ListIcon size={13} className="inline -mt-0.5" /> in the header (or <span className="text-neutral-100">Deck</span> in the bottom bar) for the whole deck on one page
          with each card&apos;s Wait / Pass, so you can skip straight to the ones worth a look. Tap a row to open that card.
        </li>
        <li>
          Curious about a name that isn&apos;t in the deck? Tap the <span className="text-neutral-100">search</span> icon <SearchIcon size={13} className="inline -mt-0.5" /> and type it.
          You get the same card plus a <span className="text-neutral-100">Scan fit</span> checklist — every hard rule of
          the nightly screen with the number behind it, plus a Minervini VCP read (contraction sequence, final
          tightness, volume dry-up) — so you can see why AAPL or NVDA is or isn&apos;t a setup tonight. Tap <span className="text-neutral-100">Live</span> in
          that page&apos;s header for an intraday read: today becomes a provisional bar from live quotes and the market
          filter recomputes from the live indexes (volume is assumed at the 20-day average until the close).
          It reads the bar store only; the nightly results are untouched.
        </li>
        <li>
          <Amber>☆ Watch</Amber> the ones with a clean box just below price — or type any symbol into the watchlist&apos;s
          Add field (its trigger is computed from stored bars). The watchlist remembers the trigger and
          alerts you the night a stock closes above its box — tap the alert pill above the deck to jump to that card, or to
          its lookup page if it isn&apos;t in tonight&apos;s deck. During the day its <span className="text-neutral-100">Live</span>{" "}
          section shows each starred name against its trigger in real time — ⚡ breaking out is the moment his playbook
          says to act. The deck gets the same read: each card shows its live chip and price, and the deck page&apos;s{" "}
          <span className="text-neutral-100">Live</span> toggle groups tonight&apos;s names by what price is doing. Quotes
          refresh within a minute or two (a free-tier budget, oldest first); off-hours the chips show the close.
        </li>
        <li>
          Buy the break of the <Amber>trigger</Amber>, ideally in the first hour on rising volume. Stop just under the{" "}
          <Amber>stop</Amber> line (or under the breakout day&apos;s low if that is tighter).
        </li>
        <li>
          Sell a third to a half into strength after 3–5 days — Kullamägi&apos;s rule of thumb — and trail the rest on
          the <Blue>10-day</Blue> or 20-day average.
        </li>
        <li>If a breakout closes back inside the box, it failed. Take the small loss; there is another deck tomorrow.</li>
      </ol>

      <H>Paper trading</H>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-300">
        The <span className="text-neutral-100">briefcase</span> icon <BriefcaseIcon size={13} className="inline -mt-0.5" /> opens the paper
        book: two ledgers that trade the deck on paper, priced on the same end-of-day bars the scan uses — nothing live, no
        broker. <span className="text-neutral-100">Auto</span> takes every qualifying card by rule and nobody touches it, so it
        measures the scanner. <span className="text-neutral-100">Manual</span> holds only the names you take, so it measures your
        selection on top of the scanner. Both use the same fill rules and the same $500 per position, so their numbers compare.
      </p>

      <Term name="What arms, and when">
        The nightly scan runs the paper book right after it stores the deck (weeknights ~midnight ET). It first settles the day just
        closed — fills, stops, queued sells, trails — then arms tonight&apos;s orders. The Auto ledger arms one order per card that has
        a box <em>and</em> a Wait verdict: a buy-stop at the <Amber>trigger</Amber> (solid amber) with the stop at the{" "}
        <Amber>stop</Amber> line (dashed amber). Pass cards and pivot-only cards never arm. A card that closed above its box top
        today is a market buy at tomorrow&apos;s open instead (a buy-stop under the market is not an order a broker takes); one that
        broke out days ago is skipped — the app&apos;s own rule is that only a pullback to the box gives an entry then. Orders follow
        the deck: a card that reappears with a new box gets the new numbers, a card that drops out or closes under its box is
        cancelled. The book you see is always <em>as of the last processed session</em>; nothing changes during the day.
      </Term>

      <Term name="How fills work">
        A buy-stop fills on the first session whose high reaches the trigger, at the trigger — or at the open if the stock gapped past
        it. A stop fills on any session whose low touches it, at the stop — or at the open if it gapped under. If the entry day also
        touches the stop, the trade counts as stopped out that same day: the order of the two touches is unknowable, so the book
        assumes the worse one. $500 per position in whole shares, so a name above $500 a share is skipped and listed under Skipped.
        No commissions, no slippage, dividends and splits ignored; a 40%+ overnight gap is flagged &ldquo;check for a split&rdquo;.
      </Term>

      <Term name="Auto ledger">
        No cash cap — every armed signal gets its $500, because a cap would make the record depend on which names happened to
        trigger first. The stop starts at the box bottom and each night moves up to the lowest low of the last 10 sessions if that is
        higher; it never moves down. That trail is the only exit. MFE / MAE on each trade show the best and worst price seen while it
        was open, so you can tell what was available versus what the rule captured.
      </Term>

      <Term name="Manual ledger">
        $10,000 to start, $500 per position, and cash binds — a take that does not fit is refused with the reason. Tap{" "}
        <span className="text-neutral-100">Take</span> on a deck card or a watchlist row to arm the same trigger and stop the card
        shows; a pivot-only name has no stop line, so it asks you to type one. When price is already above the trigger the button reads{" "}
        <span className="text-neutral-100">Take at open</span>: a market buy at the next open with the same stop. If the Auto
        ledger already filled that name before you took it, your fill is at the next open and the trade is marked{" "}
        <em>late</em>. An armed order can be removed from the paper page until it fills. One open position per name; after it
        closes, a fresh signal can be taken again.
      </Term>

      <Term name="Managing an open manual position">
        <span className="text-neutral-100">Stop</span>: raise it by hand (raise only — never lower). The chips offer the entry day&apos;s
        low and the current box bottom as one-tap levels. <span className="text-neutral-100">Trail</span>: none by default; choose a
        percent under the highest close since entry, or the lowest low of the last N sessions — evaluated at each close, only ever
        raising the stop, switchable any time. <span className="text-neutral-100">Sell</span>: queue any number of shares (default
        half) to sell at the next open, the way you would size down into strength; the stop stays on the rest. Every change takes
        effect at the next nightly run.
      </Term>

      <Term name="Reading the numbers">
        <span className="text-neutral-100">R</span> is the trade&apos;s result divided by the risk taken at entry (entry price minus the
        initial stop, times shares): −1R is a full stop-out, +2R made twice the risk. Win rate, average win and loss in R,{" "}
        <span className="text-neutral-100">expectancy</span> (average R per trade — the number that matters) and profit factor
        (gross wins ÷ gross losses) are computed from closed trades only, per ledger. A position with several exits is one trade at a
        blended exit price. Equity is cash plus open positions at the last close.
      </Term>

      <Term name="Getting started">
        Open the paper page once — that creates your ledgers, and the next nightly scan arms the Auto book. The morning after, the Auto
        tab shows the armed orders and the push notification carries a &ldquo;Paper:&rdquo; line. Fills, if any, show up the
        night after that, once the session they happened in has closed.
      </Term>

      <p className="mt-8 text-[11px] leading-relaxed text-neutral-600">
        Thresholds are fixed in <code>lib/config.ts</code>. End-of-day data only; nothing here is investment advice.
        Sources: Kullamägi&apos;s public screen settings (2019–21); Darvas, <em>How I Made $2,000,000 in the Stock
        Market</em> (1960); Livermore, <em>How to Trade in Stocks</em> (1940). Scanmana is an independent hobby
        project, not affiliated with or endorsed by Kristjan Kullamägi, Mark Minervini, or any publisher.
      </p>
      <p className="mt-2 text-[11px] text-neutral-700">
        Scanmana v{APP_VERSION} ·{" "}
        <SignOutButton>
          <button type="button" className="underline underline-offset-4 active:text-neutral-400">
            Sign out on this device
          </button>
        </SignOutButton>
      </p>
    </main>
  );
}
