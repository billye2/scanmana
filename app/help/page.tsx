import { BriefcaseIcon, ListIcon, SearchIcon } from "@/components/Icons";
import { SignOutButton } from "@clerk/nextjs";
import { APP_VERSION } from "@/lib/version";
import IndexCharts from "@/components/IndexCharts";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import RunScanButton from "@/components/RunScanButton";
import { CONFIG } from "@/lib/config";
import { latestScanSlim, loadBars } from "@/lib/scan";
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
    const [scan, bars] = await Promise.all([latestScanSlim(), loadBars([...CONFIG.MARKET.INDICES])]);
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
      <Term name="30d / All">
        The pill in the chart&apos;s top-left corner zooms to the last 30 sessions — six trading weeks, enough to see
        the base and the last few candles clearly. Tap <span className="font-mono">All</span> to return to the full
        window. On the deck the setting carries over as you swipe between cards.
      </Term>

      <H>
        <span id="market">The market strip</span>
      </H>
      <Term name="Market Bullish · Not bullish" who="Kullamägi">
        Kullamägi&apos;s first rule is that the index decides whether breakouts work at all. His stated filter: while
        the Nasdaq (QQQ) and S&amp;P (SPY) have their <span className="text-neutral-100">10-day average above the
        20-day</span>, breakouts and EPs work; when the 10 crosses under the 20, they fail repeatedly and he steps
        aside. Per index the strip shows{" "}
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

      <H>
        <span id="research">Research — what the history says</span>
      </H>
      <Term name="Research page" who="flask icon">
        Every night, after the scan, a separate Python job replays the scanner&apos;s own history and writes a
        handful of tables the app reads. Nothing here changes the scan, the verdicts or the paper book; it measures
        them. The page answers one question — is the scanner working, and did the last rule change help — in this
        order: a scorecard, the rule changes, the breakout rates, the episodic-pivot study, the threshold sweep, breadth, tonight&apos;s themes.
        Splits, the paper replay and the job log sit under <em>Maintenance</em> at the bottom. The deck, the market
        strip and the paper page each show one line from it.
      </Term>
      <Term name="Scorecard">
        Four numbers, each shown for all labelled history and again for everything since the last rule change took
        effect: the share of deck names that broke out within ten sessions, Wait minus Pass on that share, the average
        R a Wait card would have made on the box-top-buy / 10-low-trail plan, and the share of scan nights the index
        filter called Bullish. The line under the tiles reads them out; a red line above them means a job failed or the
        latest scan has no research run yet, so the numbers may be stale.
      </Term>
      <Term name="Rule changes">
        One row per shipped change, scored on the number it was meant to move — all labelled history before it against
        everything from it on. A row stays grey until the after side has 30 rows (about two weeks of decks); before
        that it says when the first read can exist. Changes are registered in code with the change itself.
      </Term>
      <Term name="Setups like this">
        On a deck card: of past deck names with the same shape (boxed or not, EP badge or not, Wait or Pass), the share
        whose close cleared its level within ten sessions (the box top, else the pivot while still overhead, else the 20-session high), and how many such names there were. Wait should beat
        Pass; when it stops doing so, the rules need a look.
      </Term>
      <Term name="Episodic pivot study" who="Kullamägi">
        His main setup is the one the deck cannot show: a stock that gaps up 10%+ on a volume surge after real
        news, best when it had been <em>neglected</em> — sideways for months, not already up — bought on the gap
        day and held for weeks with the stop at that day&apos;s low. The screen&apos;s momentum and near-the-high
        floors drop exactly those names until the gap itself delivers them. So the Research page measures the
        setup on the whole stored history instead: every gap day that fits the shape (price ≥ $
        {CONFIG.MIN_PRICE}, ≥ ${(CONFIG.MIN_DOLLAR_VOLUME / 1e6).toFixed(0)}M/day), traded the only way end-of-day
        data allows — bought at the next open, stop at the gap day&apos;s low, sold by the Auto ledger&apos;s routine —
        split by how neglected the name was and by the volume multiple. Nothing is armed from it; if the neglected,
        high-volume group pays at the next open, an EP list earns a place on the deck.
      </Term>
      <Term name="Theme">
        Stocks that moved together over the last three months, grouped from price alone (no sector data exists here).
        The chip counts tonight&apos;s deck names in the same group; the line names them. Kullamägi buys the leader
        of the strongest group. You name the groups on the Research page — the job only clusters.
      </Term>
      <Term name="Breadth">
        The share of the whole universe (about 5,000 names) above its 20-day average, under the market strip. The
        QQQ/SPY filter can say Bullish on a narrow tape; breadth under 40% while the strip is green is flagged in
        amber, and the Research page shows how the deck&apos;s hit rate falls with breadth.
      </Term>
      <Term name="Splits">
        The stored bars are unadjusted, so a reverse split reads as a +200% month and a forward split as a collapse.
        The job finds clean-ratio gaps with the matching volume signature; confirmed ones (status <em>auto</em>)
        rescale the earlier bars everywhere the app reads them. Doubtful ones wait for you on the Research page.
      </Term>
      <Term name="Threshold sweep · Replay">
        The sweep moves one screen floor at a time and shows deck size against hit rate, for retuning{" "}
        <span className="font-mono text-[12px]">lib/config.ts</span>; its first line names the one knob whose best
        value is furthest above the current one, or says nothing needs retuning. The replay runs every closed paper trade under
        other exit rules (the Kullamägi routine the Auto book trades, 5/10/15/20-session trails, a fixed 8% trail, half off at +2R) and reports which would have
        made more. Both are reports; the live rules stay as they are until you change them.
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
          shallower, volume drying up) — Wait / Pass with the reasons, computed from the same numbers at scan time. The card&apos;s
          verdict is the worst of Kullamägi, Darvas and Minervini; Livermore&apos;s read is shown but does not veto (since 1.3.0:
          the cards he alone turned to Pass, &ldquo;chasing&rdquo; past the pivot, broke out as often as the Wait cards and ran
          further — see Research). There is no &ldquo;Take&rdquo;: end-of-day data can only tell you what to watch tomorrow, never to buy now.
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
          Buy the break of the <Amber>trigger</Amber>, ideally in the first hour on rising volume. Stop under the low of the day you
          bought when that is within one ADR (Kullamägi&apos;s stop; the <Amber>stop</Amber> line, the box bottom, is the wider
          fallback). Already in a trade with no plan? <Link href="/sim" className="text-neutral-100 underline decoration-neutral-700 underline-offset-4">/sim</Link>{" "}
          prices that stop from the symbol and your entry, with the dollars at risk and the rest of this routine.
        </li>
        <li>
          Sell a third to a half into strength after 3–5 days — Kullamägi&apos;s rule of thumb — move the stop to breakeven, and
          trail the rest on the <Blue>10-day</Blue> or 20-day average. The paper book&apos;s Auto ledger runs exactly this routine.
        </li>
        <li>If a breakout closes back inside the box, it failed. Take the small loss; there is another deck tomorrow.</li>
      </ol>

      <H>Paper trading</H>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-300">
        The <span className="text-neutral-100">briefcase</span> icon <BriefcaseIcon size={13} className="inline -mt-0.5" /> opens the paper
        book: two ledgers that trade the deck on paper, priced on the same end-of-day bars the scan uses — nothing live, no
        broker. <span className="text-neutral-100">Auto</span> takes every qualifying card by rule and nobody touches it, so it
        measures the scanner. <span className="text-neutral-100">Manual</span> holds only the names you take, so it measures your
        selection on top of the scanner. Both use the same fill rules and the same notional per position, so their numbers compare.
      </p>

      <Term name="What arms, and when">
        The nightly scan runs the paper book right after it stores the deck (weeknights ~midnight ET). It first settles the day just
        closed — fills, stops, queued sells, trails — then arms tonight&apos;s orders. The Auto ledger arms one order per card that has
        a box <em>and</em> a Wait verdict <em>and</em> closed above its <Amber>trigger</Amber> today: a buy at tomorrow&apos;s open with
        the stop at today&apos;s low — Kullamägi&apos;s entry, the break confirmed by the close and the risk measured to the low of the
        breakout day. A card still inside its box arms nothing; it is only a candidate. Why the close and not the first touch: on the
        scanner&apos;s own history (1,222 boxed Wait cards, March–September 2026) a buy-stop at the trigger filled 979 times and 501 of
        those days closed back inside the box, averaging −0.42R; waiting for the close costs a little on the open and removes them.
        Pass cards and pivot-only cards never arm; a card that broke out days ago is skipped — only a pullback to the box gives an
        entry then. Orders follow the deck: a card that drops out or closes under its box is cancelled. The book you see is always{" "}
        <em>as of the last processed session</em>; nothing changes during the day.
      </Term>

      <Term name="How fills work">
        An Auto order buys at the next open; if that open is already at or under the stop the order is cancelled instead of booking a
        zero-length trade. A manual buy-stop fills on the first session whose high reaches the trigger, at the trigger — or at the open
        if the stock gapped past it. A stop fills on any session whose low touches it, at the stop — or at the open if it gapped under.
        If the entry day also touches the stop, the trade counts as stopped out that same day: the order of the two touches is
        unknowable, so the book assumes the worse one. Rule sells (the Auto book&apos;s half-off and 10-day exit) and queued manual
        sells fill at the next open. $500 per position at full size, in whole shares, so a name that costs more than the notional per share is skipped and listed under Skipped.
        No commissions, no slippage, dividends and splits ignored; a 40%+ overnight gap is flagged &ldquo;check for a split&rdquo;.
      </Term>

      <Term name="Size by the tape">
        The $500 notional is scaled by two market signals at fill time: the index filter (Bullish or not, top of the home page) and
        breadth (the share of all stocks above their 20-day average, from Research). Both on: full size. One on: half ($250). Neither:
        quarter ($125). The market strip and the paper page say which applies tonight. Why: on the scanner&apos;s own history the same
        setups averaged +0.11R when the index was Bullish and −0.11R when it was not — no setup rule beat a bad tape. Breadth is read
        from the previous session, since it is computed after the book runs. A signal that is unknown is left out, not counted against
        the trade.
      </Term>

      <Term name="Auto ledger">
        No cash cap — every armed signal gets its notional, because a cap would make the record depend on which names happened to
        trigger first. From the fill on it runs Kullamägi&apos;s exits, nothing else: the stop sits at the breakout day&apos;s low; on
        day 4 (the entry day is day 1), if the previous close is above entry, half the shares are sold at the open and the stop moves to
        breakeven; after any close under the 10-day average the rest is sold at the next open. No lowest-low trail. The numbers behind
        the choice, measured 2026-10-25 on the scanner&apos;s history with this entry: the old box-bottom stop with a 10-session-low trail
        averaged +0.04R at a 30% win rate over 14 sessions; this routine −0.03R at 42% over 5 sessions. It was adopted anyway, as the
        playbook to measure — the Auto book exists to show what these rules do on these picks, not to be tuned. Positions opened before
        the change keep the old trail until they close. MFE / MAE on each trade (defined below) show the best and worst price seen while
        it was open, so you can tell what was available versus what the rule captured.
      </Term>

      <Term name="Manual ledger">
        $10,000 to start, the same tape-sized notional per position, and cash binds — a take that does not fit is refused with the reason. Tap{" "}
        <span className="text-neutral-100">Take</span> on a deck card or a watchlist row to arm the same trigger and stop the card
        shows; a pivot-only name has no stop line, so it asks you to type one. When price is already above the trigger the button reads{" "}
        <span className="text-neutral-100">Take at open</span>: a market buy at the next open with the stop at that session&apos;s low — the
        Auto ledger&apos;s rule, so both books price a breakout-day entry the same way (since 1.4.2; before that it kept the box bottom). If the Auto
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
        blended exit price. Equity is cash plus open positions at the last close. The line under the tiles,{" "}
        <span className="text-neutral-100">By tape at entry</span>, splits the closed trades by whether the index filter read Bullish
        on the day they were entered — Kullamägi&apos;s own first rule, and on the scanner&apos;s history the difference between +0.11R
        and −0.11R a trade — so a run of losses in a weak tape reads as the tape, not the scanner.
      </Term>

      <Term name="MFE · MAE">
        <span className="text-neutral-100">Maximum Favorable Excursion</span> and{" "}
        <span className="text-neutral-100">Maximum Adverse Excursion</span>: the highest high and the lowest low printed while the trade
        was open, from the entry bar on. MFE is what was available; the exit price is what the rule captured. MAE shows how close the stop
        came to being hit before the move. On an open row the stop is amber while it still sits below entry and turns emerald once the
        trail (or your own raise) has carried it to entry or above; <span className="text-neutral-100">raised from</span> is the stop
        the trade started with and <span className="text-neutral-100">locks +xR</span> is the profit the current stop now guarantees. A
        closed row says how far the stop trailed before it was hit.
      </Term>

      <Term name="Getting started">
        Open the paper page once — that creates your ledgers, and the next nightly scan arms the Auto book. The morning after, the Auto
        tab shows the armed orders and the push notification carries a &ldquo;Paper:&rdquo; line. Fills, if any, show up the
        night after that, once the session they happened in has closed.
      </Term>

      <H>
        <span id="sim">Stop simulator</span>
      </H>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-300">
        <Link href="/sim" className="font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">/sim</Link> is for
        the trade you opened before writing the plan. Type the symbol and what you paid; add the entry date if it was not today and the
        share count if you want dollars. It prices the stop Kullamägi&apos;s rules would have set, shows the levels around it, and lays out
        the rest of the routine. It reads the bar store (and today&apos;s live quote when the entry is today) and writes nothing — the paper
        book is not touched. Linked from the lookup page and the paper page too.
      </p>

      <Term name="Which stop it picks" who="Kullamägi">
        The low of the day you bought, when that is within one <span className="text-neutral-100">ADR</span> of the entry — his stop,
        and a normal session cannot take it out. If that low is farther away, the tightest level price has respected inside one ADR:
        the breakout day&apos;s low, then the box bottom. If nothing fits, it keeps the entry-day low, marks it{" "}
        <span className="text-amber-300">wide</span>, and says how many shares keep the risk at 1% of the account — his answer to a
        wide stop is a smaller position, not a tighter line. Bought at the low of the day, there is no level under you, so it falls
        back to one ADR under the entry and says so.
      </Term>

      <Term name="The ladder">
        Every level the playbook ever uses, sorted by price: entry-day low, breakout-day low (the session that closed above its box,
        looked for in the ten sessions to your entry), box bottom, 10-session low (the Auto book&apos;s old trail), the{" "}
        <Blue>10-day</Blue> and 20-day averages as of the last close (the trail lines — shown, never recommended), and the one-ADR cap.
        Each row carries its distance in percent and either the dollars at risk on your shares or the share count for 1% risk.
        Amber rows are wider than one ADR; grey rows are not under your entry.
      </Term>

      <Term name="The rest of the playbook">
        The same four steps the Auto ledger runs: the stop, half off at the open of day 4 if day 3 closes above the entry (the entry
        day is day 1), the stop to breakeven after that, the rest sold at the next open after a close under the 10-day average. With
        an entry date in the past each step says where you stand — day 2 of 3, half due at tomorrow&apos;s open, already stopped out on
        such a date — so you can see whether the plan you did not write would already have you out.
      </Term>

      <Term name="Same numbers as the Take button">
        The page and the paper book price a stop with one function (<code>lib/stop-plan.ts</code>). A card that reads{" "}
        <span className="text-neutral-100">Take at open</span> stops at that session&apos;s low, which is what the simulator recommends
        for an entry at that close; a card still under its trigger keeps the box bottom, because the day whose low would be the stop has
        not happened yet.
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
