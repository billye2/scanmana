"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { price } from "@/lib/format";
import type { Book, BookPosition, BookTrack } from "@/lib/paper-db";
import type { Track, TrailMode } from "@/lib/paper-engine";

const BTN = "rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-700 disabled:opacity-40";
const INPUT = "w-24 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100";
const CHIP = "rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300 active:bg-neutral-700";

const money = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toFixed(0)}`;
const rr = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);
const pnlTone = (x: number | null) => (x === null ? "text-neutral-400" : x > 0 ? "text-emerald-400" : x < 0 ? "text-red-400" : "text-neutral-300");

async function post(path: string, body: unknown, method = "POST"): Promise<string | null> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? `${res.status}`;
}

export default function PaperBook({ book }: { book: Book }) {
  const router = useRouter();
  const [track, setTrack] = useState<Track>("manual");
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const t = book[track];

  async function removeOrder(orderId: number) {
    setOrderMsg(null);
    const err = await post("/api/paper/order", { orderId }, "DELETE");
    if (err) setOrderMsg(err);
    else router.refresh();
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        {(["manual", "auto"] as Track[]).map((k) => (
          <button
            key={k}
            onClick={() => setTrack(k)}
            aria-pressed={track === k}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${track === k ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-300"}`}
          >
            {k === "manual" ? "Manual" : "Auto"}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-neutral-500">{book.asOf ? `book as of ${book.asOf}` : "no session processed yet"}</span>
      </div>
      <p className="text-[12px] leading-relaxed text-neutral-500">
        {track === "manual"
          ? "Your picks: $10,000 start, $500 per position, cash binds. Raise the stop, pick a trail, or sell some at the next open."
          : "Every boxed Wait card, $500 each, no cash cap, stop trails the 10-session low. Hands off — this measures the scanner."}
      </p>
      <Stats t={t} />
      <Section title={`Armed orders · ${t.orders.length}`}>
        {t.orders.length === 0 ? (
          <Empty>{track === "manual" ? "Nothing armed — tap Take on a deck card or a watchlist row." : "Nothing armed tonight."}</Empty>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {t.orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2 text-xs">
                <Link href={`/s/${o.ticker}`} className="font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">{o.ticker}</Link>
                <span className="text-neutral-400">
                  {o.kind === "market" ? (
                    <>buy at the next open <span className="text-neutral-500">(above the {price(o.trigger)} trigger)</span></>
                  ) : (
                    <>buy stop <span className="text-amber-400">{price(o.trigger)}</span></>
                  )}
                  {" · "}stop <span className="text-amber-400/80">{price(o.stop)}</span>
                  {o.lastClose !== null && <> · last {price(o.lastClose)}</>}
                  {o.late && <span className="ml-1 text-neutral-500">(late: the auto order already filled)</span>}
                </span>
                {track === "manual" && (
                  <button onClick={() => removeOrder(o.id)} className={`${BTN} ml-2 shrink-0`} aria-label={`Remove the ${o.ticker} order`}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {orderMsg && <p className="mt-1 text-xs text-red-300">{orderMsg}</p>}
      </Section>
      <Section title={`Open · ${t.open.length}`}>
        {t.open.length === 0 ? <Empty>No open positions.</Empty> : t.open.map((p) => <OpenPosition key={p.id} p={p} editable={track === "manual"} />)}
      </Section>
      <Section title={`Closed · ${t.closed.length}`}>
        {t.closed.length === 0 ? (
          <Empty>No closed trades yet.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {t.closed.map((p) => (
              <li key={p.id} className="py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span>
                    <Link href={`/s/${p.ticker}`} className="font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">{p.ticker}</Link>
                    <span className="ml-2 text-neutral-500">{p.entryDate} → {p.closedDate}</span>
                  </span>
                  <span className={`font-semibold ${pnlTone(p.realizedPnl)}`}>{money(p.realizedPnl)} · {rr(p.realizedR)}</span>
                </div>
                <div className="text-neutral-500">
                  in {price(p.entryPrice)} · out{" "}
                  {p.exits.map((e, i) => (
                    <span key={i}>
                      {i > 0 && ", "}
                      {price(e.price)} ×{e.shares} {e.reason === "stop" ? "stop" : "sold"}
                    </span>
                  ))}
                  {" · "}MFE {price(p.mfe)} · MAE {price(p.mae)}
                  {p.late && " · late"}
                  {p.splitFlagged && <span className="text-amber-300"> · check for a split</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {t.skips.length > 0 && (
        <Section title={`Skipped · ${t.skips.length}`}>
          <ul className="space-y-1 text-[11px] text-neutral-500">
            {t.skips.map((s, i) => (
              <li key={i}>
                {s.date} <span className="text-neutral-300">{s.ticker}</span> — {s.reason}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Stats({ t }: { t: BookTrack }) {
  const s = t.stats;
  const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(0)}%`);
  const realized = t.stats.equityCurve.at(-1)?.equity ?? 0;
  const cells: [string, string, string?][] = [
    ["Equity", money(t.equity), pnlTone(t.equity - t.startCash)],
    ["Cash", money(t.cash)],
    ["Realized", money(realized), pnlTone(realized)],
    ["Trades", String(s.trades)],
    ["Win rate", pct(s.winRate)],
    ["Expectancy", rr(s.expectancyR)],
    ["Avg win / loss", `${rr(s.avgWinR)} / ${rr(s.avgLossR)}`],
    ["Profit factor", s.profitFactor === null ? "—" : s.profitFactor.toFixed(2)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-neutral-900 p-3 sm:grid-cols-4">
      {cells.map(([k, v, tone]) => (
        <div key={k}>
          <dt className="text-[10px] tracking-wide text-neutral-500 uppercase">{k}</dt>
          <dd className={`text-sm font-semibold ${tone ?? "text-neutral-100"}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function OpenPosition({ p, editable }: { p: BookPosition; editable: boolean }) {
  const router = useRouter();
  const [stop, setStop] = useState(p.currentStop.toFixed(2));
  const [mode, setMode] = useState<TrailMode>(p.trailMode);
  const [param, setParam] = useState(p.trailMode === "percent" ? ((p.trailParam ?? 0.1) * 100).toFixed(0) : String(p.trailParam ?? 10));
  const [sell, setSell] = useState(String(Math.max(1, Math.floor(p.shares / 2))));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(path: string, body: unknown) {
    setBusy(true);
    setMsg(null);
    const err = await post(path, body);
    setBusy(false);
    if (err) setMsg(err);
    else router.refresh();
  }

  const trailText =
    p.trailMode === "percent" ? `${((p.trailParam ?? 0) * 100).toFixed(0)}% under the peak close` : p.trailMode === "lowestlow" ? `${p.trailParam}-session low` : null;

  return (
    <div className="border-b border-neutral-800 py-3 text-xs">
      <div className="flex items-center justify-between">
        <span>
          <Link href={`/s/${p.ticker}`} className="text-sm font-semibold text-neutral-100 underline decoration-neutral-700 underline-offset-4">{p.ticker}</Link>
          <span className="ml-2 text-neutral-500">
            {p.shares} sh · in {price(p.entryPrice)} on {p.entryDate}
            {p.late && " · late"}
          </span>
        </span>
        <span className={`font-semibold ${pnlTone(p.unrealized)}`}>
          {p.unrealized === null ? "—" : `${money(p.unrealized)} · ${rr(p.unrealizedR)}`}
        </span>
      </div>
      <div className="mt-1 text-neutral-400">
        stop <span className="text-amber-400/80">{price(p.currentStop)}</span>
        {trailText && <span className="text-neutral-500"> (trail: {trailText})</span>}
        {" · "}last {p.lastClose !== null ? price(p.lastClose) : "—"}
        {p.lastDate && p.lastDate < p.entryDate && <span className="text-amber-300"> · no data since {p.lastDate}</span>}
        {" · "}MFE {price(p.mfe)}
        {p.exits.length > 0 && <> · sold {p.exits.reduce((s, e) => s + e.shares, 0)} so far</>}
        {p.pendingSellShares && <span className="text-sky-300"> · selling {p.pendingSellShares} at the next open</span>}
        {p.splitFlagged && <span className="text-amber-300"> · check for a split</span>}
      </div>
      {editable && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-neutral-500">Stop</label>
            <input type="number" step="0.01" inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} className={INPUT} />
            <button disabled={busy} className={BTN} onClick={() => act("/api/paper/stop", { positionId: p.id, stop: Number(stop) })}>
              Raise
            </button>
            {p.entryDayLow !== null && p.entryDayLow > p.currentStop && (
              <button className={CHIP} onClick={() => setStop(p.entryDayLow!.toFixed(2))}>entry-day low {price(p.entryDayLow)}</button>
            )}
            {p.latestBoxBottom !== null && p.latestBoxBottom > p.currentStop && (
              <button className={CHIP} onClick={() => setStop(p.latestBoxBottom!.toFixed(2))}>box bottom {price(p.latestBoxBottom)}</button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-neutral-500">Trail</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as TrailMode)} className={INPUT}>
              <option value="none">none</option>
              <option value="percent">% under peak</option>
              <option value="lowestlow">N-session low</option>
            </select>
            {mode !== "none" && (
              <input type="number" inputMode="numeric" value={param} onChange={(e) => setParam(e.target.value)} className={INPUT} aria-label={mode === "percent" ? "percent" : "sessions"} />
            )}
            <button
              disabled={busy}
              className={BTN}
              onClick={() => act("/api/paper/trail", { positionId: p.id, mode, param: mode === "percent" ? Number(param) / 100 : Number(param) })}
            >
              Set
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-neutral-500">Sell</label>
            <input type="number" inputMode="numeric" min={1} max={p.shares} value={sell} onChange={(e) => setSell(e.target.value)} className={INPUT} />
            <button disabled={busy} className={BTN} onClick={() => act("/api/paper/sell", { positionId: p.id, shares: Number(sell) })}>
              Sell at next open
            </button>
            {p.pendingSellShares && (
              <button disabled={busy} className={CHIP} onClick={() => act("/api/paper/sell", { positionId: p.id, cancel: true })}>cancel queued sell</button>
            )}
          </div>
          {msg && <p className="text-red-300">{msg}</p>}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-[11px] font-semibold tracking-wide text-emerald-400 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-xs text-neutral-500">{children}</p>;
}
