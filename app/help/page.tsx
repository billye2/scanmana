import { BriefcaseIcon, ListIcon, SearchIcon } from "@/components/Icons";
import { SignOutButton } from "@clerk/nextjs";
import { APP_VERSION } from "@/lib/version";
import IndexCharts from "@/components/IndexCharts";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import RunScanButton from "@/components/RunScanButton";
import { CONFIG } from "@/lib/config";
import { liveIndexBars } from "@/lib/intraday";
import { latestScanSlim } from "@/lib/scan";
import type { Bar, IndexHealth, MarketHealth } from "@/lib/types";

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
  let indexHealthRows: IndexHealth[] | undefined;
  let indexAsOf: string | null = null;
  let indexProvisional = false;
  let market: MarketHealth | undefined;
  try {
    // The charts follow the day (live index quotes at the 30-minute TTL, 1.8.2); the verdict line stays the scan's.
    const [scan, live] = await Promise.all([latestScanSlim(), liveIndexBars()]);
    market = scan?.market;
    indexBars = live.bars;
    indexHealthRows = live.health.length > 0 ? live.health : market?.indices;
    indexAsOf = live.asOf;
    indexProvisional = live.provisional;
  } catch {
    // DB not configured — the page still renders the text.
  }
  return (
    <main className="mx-auto w-full max-w-xl px-4 lg:max-w-4xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav current="/help" subtitle="Help" />

      <p className="text-[13px] leading-relaxed text-neutral-300">
        Scanmana is built around one setup: the 5-star breakout of{" "}
        <span className="text-neutral-100">Kristjan Kullamägi</span> (&ldquo;Qullamaggie&rdquo;), a Swedish trader who
        published his rules and numbers around 2019–2021. A 5-star setup is a stock that has already made a big move,
        then rests for weeks in a tight, orderly range while the 10- and 20-day averages catch up, with enough daily
        range to move again when it goes. Every night after the close Scanmana finds those stocks from daily bars,
        draws the range on the chart, and prices the entry and the stop a person can place the night before, without
        watching the open. A boxed Wait card is the app&apos;s candidate for his setup. The chart overlays borrow two
        older ideas: the Darvas box (1950s) is how the range is found, and the Livermore pivot (1920s–30s) is the
        fallback trigger when there is no box — neither is a method of its own here. His other setup, the episodic
        pivot, is a measured study on the Research page, not something the deck arms.
      </p>

      <div id="finding" className="mt-4 rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-3 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">What the history says — read this first</div>
        <p className="mt-1 text-[13px] leading-relaxed text-neutral-200">
          <span className="font-semibold text-neutral-100">It is all about entry and exit management, not picking would-be winners.</span>{" "}
          Kullamägi himself put his hit rate at 25 to 50%; his results came from cutting every loser small and holding the few that ran,
          not from being right about which chart would go. Scanmana&apos;s own history says the same. Of 8,001 scored deck cards, 38% never
          cleared their level in ten sessions, and of the ones that did, 47% ran 15% or more in twenty sessions — a coin toss, for anyone,
          from the left side of the chart. The 5-star shape (a boxed Wait resting under its box top) ran{" "}
          <em>less</em> often than the rest of the deck, 26% against 29%; the one factor that separated was the tape, 40% ran on a Bullish
          night against 25% on a Not bullish one. And the Auto plan&apos;s own record, 41% wins at +1.4R against −0.9R losses, nets to about
          zero: a sharper eye moves the 41% a little, holding the runners longer moves the +1.4R a lot. So use the deck for what it is, a
          list of candidates on a tape that allows them, and spend the effort where the money is: the stop at entry, the half off, the trail,
          and the discipline to stay in a winner. The <Link href="/drill" className="text-neutral-100 underline underline-offset-4">drill</Link>{" "}
          will show you the coin toss first hand. Read on 2026-11-09, in-sample, raw price.
        </p>
      </div>

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
          <span className="text-neutral-100">Parabolic guard:</span> {Number.isFinite(CONFIG.MAX_ADR_PCT) ? `ADR above ${CONFIG.MAX_ADR_PCT}% or more than` : "More than"} +
          {CONFIG.MAX_RET_1M * 100}% in a month is rejected{Number.isFinite(CONFIG.MAX_ADR_PCT) ? "" : " (the ADR ceiling came off in 1.6.2 — a big ADR is what a mover looks like)"} — a shell that went from $1 to $18 in three weeks
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
        strong intraday move) <em>above</em> it is the buy signal: the stock has left the box upward. On the night
        that happens the card keeps the box it just left, so the trigger you see is the level the close beat; the
        next night the box is gone or a higher ceiling takes its place. The small percentage next to it is how far
        price is below the trigger right now.
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
        <span className="mt-2 block">
          The charts below follow the day: during the session today&apos;s candle is a provisional bar from a live quote,
          refreshed at most every 30 minutes when the page loads, and the chips over each chart are recomputed from it.
          The verdict above, the strip on the other pages, the scan and the paper book stay on the close.
        </span>
        <IndexCharts bars={indexBars} health={indexHealthRows} asOf={indexAsOf} provisional={indexProvisional} />
      </Term>
      <Term name="The tape page">
        <span id="tape" />
        <Link href="/tape" className="font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">/tape</Link> is the
        strip above, over time: a first line that says how long the current verdict has held, where breadth stands against ten sessions
        earlier, how much of the window was Bullish and the size the paper book takes tonight; the three breadth lines (above the 20-day,
        above the 50-day, 10-day over 20-day) on green bands where the verdict was Bullish, with the 50% line the sizing rule reads; new
        highs against new lows per session; the sizing table (full · half · quarter) with tonight&apos;s row lit; and what the deck did under
        each verdict — breakout rate and the Auto plan&apos;s average R by the index call on scan night, and the breakout rate by breadth.
        Windows of 60, 120 or 250 sessions. Reads only; nothing here changes a scan. On the bar when you tick it under the gear.
      </Term>

      <H>
        <span id="research">Research — what the history says</span>
      </H>
      <Term name="Research page" who="flask icon">
        Every night, after the scan, a separate Python job replays the scanner&apos;s own history and writes a
        handful of tables the app reads. Nothing here changes the scan, the verdicts or the paper book; it measures
        them. The page answers one question — is the scanner working, and did the last rule change help — and since 1.7.5 keeps
        to it: this week&apos;s read, the scorecard, the rule changes. Splits, the paper replay and the job log sit under{" "}
        <em>Maintenance</em> at the bottom. The deck, the market strip and the paper page each show one line from it.
      </Term>
      <Term name="Studies page" who="open-book icon">
        <span id="studies" />
        <Link href="/studies" className="font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">/studies</Link> holds
        the deeper reads that used to sit between the scorecard and Maintenance: Kullamägi&apos;s plan on every boxed Wait card, the breakout
        rates, the episodic-pivot study, the threshold sweep, market breadth, tonight&apos;s themes and the themes scored. Every one is a study —
        it reads the nightly tables and changes nothing. A rule changes only when a study says so, and then the Research page scores it. New
        studies from the Python jobs land here. On the bar when you tick it under the gear.
      </Term>
      <Term name="This week's read">
        The page opens with its verdict, written by rules from the numbers below it, the way a card&apos;s analysis is. The headline follows
        the rule-change table: <em>Nothing to change</em> while no change has its 30 rows yet, <em>The last change holds</em> when a scored
        change moved its number the right way, <em>Revisit …</em> when one moved it the wrong way. Then the deck&apos;s breakout rate since the
        last change against all history, and the tape: breadth now and ten sessions ago, the index filter, the paper size that follows. The
        grey line names the episodic-pivot row worth watching and the job status. Nothing here is a model&apos;s opinion.
      </Term>
      <Term name="Scorecard">
        Four numbers, each shown for all labelled history and again for everything since the last rule change took
        effect: the share of deck names that broke out within ten sessions, Wait minus Pass on that share, the average
        R a Wait card would have made on the plan the Auto ledger trades (the open after the first close above the box,
        stop at that day&apos;s low, his exits), and the share of scan nights the index filter called Bullish. The line
        under the tiles reads them out; a red line above them means a job failed or the latest scan has no research run
        yet, so the numbers may be stale.
      </Term>
      <Term name="Kullamägi's plan on every boxed Wait card">
        The Auto ledger has closed only a handful of trades under his entry, so this card scores that entry on the whole
        deck history instead: every boxed Wait card that closed under its box top on scan night, bought at the open after
        its first close above the box within ten sessions with the stop at that day&apos;s low, and sold by the ledger&apos;s own
        routine. Three tables: by how wide that stop was in units of the card&apos;s ADR (a stop wider than one average day is
        the one his rule would not take), by the card&apos;s ADR, and the same cards bought instead with a resting buy-stop at
        the box top and the stop one ADR under the fill — the entry a person can leave with a broker without watching the
        open. &ldquo;Filled&rdquo; is the share of cards each entry actually bought. The width table decided the one-ADR rule the
        ledger has run since 1.6.3 (2026-11-03: stops within one ADR +0.06R on 483 rows, wider −0.19R on 268); the entry table
        decides which entry it keeps (the next open led the buy-stop, −0.03R to −0.17R, on that date). The paper replay carries the
        matching rule, &ldquo;stop one ADR under the entry&rdquo;, on the ledger&apos;s real trades.
      </Term>
      <Term name="Where the move goes after the entry">
        The follow-through card on Studies (1.7.7): the same boxed Wait cards the plan card scores, bought at the open after their
        first close above the box and then simply held for twenty sessions, no exit applied. The solid line is the mean gain over the
        entry on each day of the trade (day 1 is the entry session, as the ledger counts it), the dashed line the mean of the lowest low
        so far — how deep the average shake-out runs. The two marks are where the Auto ledger acts: half off on day 4, and the 10-session
        average it sells under. Tabs split the cards by ADR, by the index verdict on scan night and by stop width. Only cards with all
        twenty days count, so a group&apos;s row count holds across the chart. The sentence under the table names the day the mean gain
        peaks and the day the mean low bottoms. Together with the exit sweep this decides whether the ledger&apos;s routine changes — and
        only then, as a scored rule change.
      </Term>
      <Term name="Where the R leaks: stop or exit">
        The post-mortem on Studies (1.8.9): every trade the Auto ledger would have bought, run through today&apos;s exit routine on up to
        sixty sessions from the entry and taken apart. The table groups the trades by how they ended (the first stop, the breakeven stop after the
        partial, a close under the average, or still open when the window ends) with the average R of each and how many ran after the exit, meaning
        a later close in the window two R or more over the entry. Two leaks are counted over all trades so they can be compared. Shaken
        out: stopped at the first stop, then it ran. Gave back: the best close while the trade was held reached one R or more and the routine kept
        less than half. The sentence names the larger when they differ by three points of all trades. It is a study and changes nothing:
        the exit routine still changes only through the sweep&apos;s gate.
      </Term>
      <Term name="Exit routine, swept">
        The grid on Studies (1.7.9): the Auto ledger&apos;s exit routine run twelve ways on the same cards, over up to sixty
        sessions from the entry (1.9.1; twenty before that, which marked every runner to its day-20 close) — the day the first half comes off (3, 4 or 5), the average it sells under (10- or 20-day) and whether the
        stop moves to breakeven after the partial. Each cell is the average R with its range; today&apos;s routine is boxed. The sentence under
        it applies the gate agreed for the plan: a change is on the table only when the best cell beats today&apos;s with both at thirty rows and
        the two ranges apart, and the follow-through paths do not argue — if the best cell moves the partial day, the day the mean gain
        peaks has to sit on the same side. Even then nothing changes by itself: the routine changes as one scored rule-change row on Research.
      </Term>
      <Term name="The bar under a number">
        Since 1.7.6 every rate and average R on the Research, Studies and Tape pages carries its 95% range, drawn as a thin bar under the
        number with a dot at the value (hover for the figures). A rate&apos;s range comes from its sample size alone (Wilson); an average
        R&apos;s from its spread and sample size. Where two bars overlap, the gap between the two numbers is not yet a finding, however it
        reads. A rule-change row turns green or red only once its before and after ranges are apart; amber means they still overlap, and
        this week&apos;s read says so instead of giving a verdict. The ranges are closed-form, not bootstrapped: at thirty rows and up the
        two agree, and the Python budget is kept for the studies that need it.
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
        <span className="mt-1 block">
          <span className="text-neutral-100">Themes, scored</span> (Research, since 1.7.4): membership has been saved every night since
          2026-09-21, so every deck row since then is scored by the theme it sat in that night — first by how many other deck names
          shared the theme (none · alone · 2–3 · 4+; his claim is that leaders move in groups, so the 4+ row should break out most
          often), then one row per theme. Since 1.7.8 a theme has a stable id: each night&apos;s groups are matched to the themes of the
          ten nights before by how many members they share (half or more keeps the id — a split keeps it on the larger half, a
          merge takes the theme it overlaps most, and a theme unseen for ten nights ends), so a change of leaders no longer breaks a
          theme into several rows. The row shows the nights the theme has been seen, its first and last night, and a small line of its
          rank among the night&apos;s groups over that life (top of the box is strongest). A name you give a theme follows the id. Grey
          under 30 rows.
        </span>
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
          deck (it wraps around), <span className="text-neutral-100">space</span> opens the Google search for the card. On a symbol
          page and on the stop simulator the bar&apos;s left slot is <span className="text-neutral-100">Back</span>: it returns to the page
          you came from, or to the deck list (the paper book from the simulator) when the page was opened cold — the home-screen app has
          no browser bar of its own.
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
          Tap the <span className="text-neutral-100">list</span> icon <ListIcon size={13} className="inline -mt-0.5" /> in the header (or <span className="text-neutral-100">Deck</span> in the bottom bar) for the whole deck on one page,
          grouped by what happens at the open: <span className="text-neutral-100">Arms tonight</span> (the names the Auto book buys at the open, each with
          its stop, risk and share count), <span className="text-neutral-100">Inside the box</span> (Wait cards still under their box top, closest to the
          trigger first), Wait cards the book cannot arm, and Pass folded away at the bottom. The groups come from the same arming test the Auto
          book runs, so the list never disagrees with the ledger. Tap a Wait / Pass / ★ chip to filter, tap it again to clear. Tap a row to open that card.
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
          <span className="text-neutral-100">Live</span> toggle orders each group by what price is doing and shows the live read in place of the verdict chip. Quotes
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

      <Term name="Auto book tonight">
        The box under every deck chart says what the Auto book does with that card on the scan night, written from the same function
        that arms the orders: <em>arms · buy at open</em> on the first close above the box (with the stop at that day&apos;s low and the
        day-4 and 10-day rules spelled out), <em>waits · inside the box</em> with the distance to the top, or <em>not armed</em> with the
        reason — a Pass verdict, a close under the box bottom, a breakout before this session, a breakout day whose low sits more than
        one ADR under the close (the stop would be wider than one average day, so the Auto book declines it and lists it under Skipped
        on the paper page), no box. The trigger line below it adds what a
        manual Take would risk: the stop it would be given, the risk from entry to that stop in percent, and the whole shares the $500
        notional buys at tonight&apos;s tape size. A symbol outside tonight&apos;s deck shows no box: the Auto book never sees it.
      </Term>
      <Term name="Tomorrow, per position">
        The box under each open position on Paper (1.9.3). The first line is what the open does: hold, sell half (day 4 after a close above
        the entry, and the stop then moves to the entry), or sell everything (it closed under the 10-day, or you asked). Under it are the
        prices that would change that. The stop, with its distance under the last close: a trade at or under it sells everything. For a
        ledger on Kullamägi&apos;s routine, the close it has to hold tomorrow: that price is the average of the last nine closes, because
        tomorrow&apos;s close is under tomorrow&apos;s 10-day average exactly when it is under that number, so it is the real line and not
        today&apos;s average. And the day count to the day-4 half. A manual position shows its trail instead. It is the same arithmetic the
        nightly run applies, read one night ahead; nothing here places or changes an order.
      </Term>
      <Term name="At the open">
        One line under the market strip (and at the top of this page) that says what the paper book does at tomorrow&apos;s open, read
        from the book&apos;s own rows: which market orders fill (with the tape size), which buy-stops are waiting on their trigger, which
        Auto positions sell half (day 4, up on the entry), which exit (a close under the 10-day, or a sale you requested), how many are
        held and which held stop sits closest under the last close. The nightly push leads with the same actions. &ldquo;Nothing to do&rdquo;
        means no order is armed and nothing is open.
      </Term>
      <Term name="Position on the chart">
        Open a name you hold in either ledger (tap its ticker on the paper page) and its chart carries the position: the entry in blue, the
        stop as it stands in green, and — once a trail or your hand has raised it — the first stop in red, dashed, so a moved stop is a
        visible gap rather than a sentence. An Auto position also gets a dot under its day-4 bar, the session the half-off rule looks at;
        before that bar exists the line under the lookup says how many sessions away it is.
      </Term>
      <Term name="Auto ledger">
        No cash cap — every armed signal gets its notional, because a cap would make the record depend on which names happened to
        trigger first. One signal it declines (since 1.6.3, 2026-11-03): a breakout day whose low is more than one ADR under the close,
        because the stop would be wider than one average day&apos;s range — measured on the scanner&apos;s history, stops within one ADR
        made +0.06R a trade (483 rows) and wider ones −0.19R (268). Those names are listed under Skipped with both numbers. From the
        fill on it runs Kullamägi&apos;s exits, nothing else: the stop sits at the breakout day&apos;s low; on
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
        <span className="text-neutral-100">Take</span> on a deck card or a watchlist row to arm the same trigger the card
        shows with the stop in the box beside the button. The box starts at the rule&apos;s stop, and the chips under it are the levels you
        can pick instead — today&apos;s low, the box bottom, the 10-session low — each with its distance from the entry, the rule&apos;s
        level marked <em>his rule</em> and anything farther than one average day&apos;s range marked <em>wide</em>; tap a chip or type a
        price. A pivot-only name has no rule stop, so one must be picked or typed. When price is already above the trigger the button reads{" "}
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

      <Term name="The fan">
        <span id="fan" />
        Under the Auto ledger&apos;s replay line (1.8.0): the plan&apos;s own history — the R of every boxed Wait card it entered, the same
        rows the plan card scores — shuffled five thousand times into runs of trades, and the cumulative R after each trade drawn as a
        fan: the light band holds nine in ten runs, the darker band the middle half, the dashed line the median. The amber line is the
        ledger&apos;s actual path, trade by trade, and the sentence places its last point as a percentile of the runs with the same count.
        Inside the fan the book is doing what its plan does by chance, hot or cold; outside it on the low side, the trades deserve a
        look before the plan does. The bands move only when history does (a fixed seed), and nothing on the book reads them: this one
        card is understanding, not a decision.
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
        <span id="sections">The top bar and the gear</span>
      </H>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-300">
        The icons beside the logo are yours to choose. The gear at the right end opens{" "}
        <Link href="/sections" className="font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">/sections</Link>: every
        section of the app, ranked by how often Kullamägi&apos;s routine has you open it — the deck list grouped by the open each evening, the paper
        book each morning, the best setups and the research page each week, then the watchlist, the stop simulator, the lookup and this page.
        Tick up to six and the bar carries them in that order, first thing needed first; once six are ticked the rest grey out until one is
        unticked. Each row also opens its section, so whatever you leave off the bar stays two taps away. The choice is kept on this device
        for a year (a cookie), so the phone and the desktop can carry different bars. The suggested six are the deck list, paper, best setups,
        research, watchlist and lookup. The home deck&apos;s bottom bar follows: previous card · your first four picks · the card counter. The card&apos;s
        watch star sits beside the ticker. The same page carries <span className="font-semibold text-neutral-100">Text size</span>: Default, Large or
        Larger scales every line of text in the app on this device (the body text here goes from 13 to 16 or 18 pixels; the charts keep their own
        small labels). The home-screen app cannot pinch-zoom, so this is the way to make these pages readable.
      </p>

      <H>
        <span id="gallery">Best setups</span>
      </H>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-300">
        <Link href="/gallery" className="font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">/gallery</Link> is
        Kullamägi&apos;s monthly review of the charts that worked, done on the scanner&apos;s own picks: the deck cards whose best close in
        the twenty sessions after their scan night was highest, one per name, over the last 60 or 180 days of scan nights or all history
        (a night is scored only twenty sessions later, so the shortest view is about a month of scored nights). Each card draws
        the move into the box, the scan night and the Auto book&apos;s buy (the open after the first close above the box) marked under the
        bars, and the follow-through; the line under it says how far price went, which day it broke, and what the Auto plan made with
        how wide its stop was; the grey line is the scan-night facts (ADR, tightness, distance from the high, the three returns, the tape).
        The box at the top says what the shown setups had in common that night — the question the review exists to answer. The{" "}
        <span className="text-emerald-400">5-star only</span> switch keeps just the boxed Wait cards that were still resting under their box
        top on scan night — the app&apos;s candidate for his 5-star setup — so you can compare the best of those with the best of the whole
        deck; a small green star before a ticker marks such a card in either view. A card
        appears only once twenty sessions have passed and the nightly outcomes job has scored it. Reads history, writes nothing; linked
        from the research page, no nav icon.
      </p>

      <H>
        <span id="drill">Drill</span>
      </H>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-300">
        <Link href="/drill" className="font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">/drill</Link> (dumbbell
        icon) is the gallery with the answers covered. Kullamägi trained his eye on thousands of charts with the right side hidden; this page
        draws one scored deck card at random — winners and losers alike — up to its scan night, with the name and the night hidden and only
        the scan-night facts under it (ADR, tightness, distance from the high, the three returns, the tape), and asks for one call:{" "}
        <span className="font-semibold text-emerald-400">Take</span> or <span className="font-semibold text-neutral-100">Skip</span>. Then it
        uncovers the twenty sessions after, with the box and the gallery&apos;s markers, says who it was and what the app said that night, and
        grades the call; &ldquo;Review setup&rdquo; under the answer chart opens the covered chart again beneath it, so the setup and what
        followed sit one above the other. A chart <em>ran</em> when its best close in those twenty sessions was 15% or more over the scan-night close; it{" "}
        <em>never filled</em> when it did not close above its level in ten sessions (a Take on such a chart is no trade and gets no grade);
        anything else <em>fizzled</em>. Take is right on a run, Skip is right on anything else. The box at the top is your record: charts
        called, your hit rate, the 5-star rule&apos;s hit rate on the very same charts, the share of your filled takes that ran (the trader&apos;s
        number), and the share of all charts that ran — what a coin toss would score. Each call is stored once against your account; a name
        you called in your last thirty calls sits out so a second look is never from memory. &ldquo;Start over&rdquo; at the bottom forgets
        every call.
      </p>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-300">
        <span className="font-semibold text-neutral-100">The stop question (1.9.2).</span> A Take on a boxed card resting at or under its
        box top asks one more thing before the chart is uncovered: where does the stop go. The trade is the Auto ledger&apos;s, the open
        after the first close above the box, and there are four levels. The breakout day&apos;s low is the ledger&apos;s own stop and has no
        price yet. One ADR under the entry is set at the fill. Tonight&apos;s 10-session low and the box bottom are on the chart now, and
        tapping either draws it. &ldquo;Set this stop&rdquo; stores the call. The answer then shows the same trade four times, once per
        stop, sold by the ledger&apos;s exit routine over up to sixty sessions: the risk under the fill, how it ended and on which day, and
        the R. Your stop is marked, with the ledger&apos;s stop and the best of the four beside it. Your record adds the stops placed and
        your average R a trade against the ledger&apos;s stop on the same trades. A tight stop is shaken out more often and pays more R
        when it holds; a wide one survives and pays fewer. The table is where you see which of the two this chart was.
      </p>

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
