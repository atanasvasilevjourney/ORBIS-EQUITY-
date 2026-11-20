"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { buildActiveBook, type ActiveBook, type ActivePayload } from "@/lib/portfolio/activeBook";
import type { CapitalBookTag, SleeveName } from "@/lib/capitalBook";
import { Spark } from "@/components/portfolio/charts";
import { pct, tone, usd } from "@/components/portfolio/format";

const SLEEVE_HREF: Record<SleeveName, string> = {
  LOOP: "/loop",
  ORB: "/orb",
  CASH: "/cash",
  ROTATE: "/rotate",
};

const SLEEVE_COLOR: Record<SleeveName, string> = {
  LOOP: "#3b82f6",
  ORB: "#a78bfa",
  CASH: "#34d399",
  ROTATE: "#f59e0b",
};

const BOOK_LABEL: Record<CapitalBookTag, string> = {
  loop: "LOOP",
  orb: "Breakout",
  tema: "TEMA",
  carver: "Carver",
  rotate: "Rotate",
};

type Filter = "ALL" | SleeveName;

export function ActiveTrading() {
  const [payload, setPayload] = useState<ActivePayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolio/active");
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as ActivePayload;
        if (!cancel) setPayload(body);
      } catch {
        if (!cancel) setFailed(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const book = useMemo(() => (payload ? buildActiveBook(payload.legs) : null), [payload]);
  const q = query.trim().toUpperCase();
  const lines =
    book?.lines.filter(
      (line) => (filter === "ALL" || line.sleeve === filter) && (!q || line.symbol.includes(q)),
    ) ?? [];

  return (
    <section className="pf-card" id="pf-active">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pf-kicker">Pro · Subportfolio</p>
          <h2 className="text-lg font-semibold mt-1">Active Trading</h2>
          <p className="mt-1 max-w-3xl text-[12px] text-[var(--text-secondary)]">
            Open short-term paper trades from LOOP, ORB, CASH, and ROTATE. Weights are each line’s share of combined gross. This book sits beside the long-term basket and does not move the sliders.
          </p>
        </div>
      </div>

      {!payload && !failed && (
        <p className="mt-4 text-sm text-[var(--text-secondary)]">Reading LOOP, ORB, CASH, and ROTATE…</p>
      )}

      {failed && (
        <p className="mt-4 text-sm text-[var(--text-secondary)]">
          The trading desks did not answer. The long-term basket is unchanged.
        </p>
      )}

      {payload?.unavailable && (
        <p className="mt-4 text-sm text-[var(--text-secondary)]">
          The paper books are offline. Active Trading stays empty until LOOP, ORB, CASH, and ROTATE can be read.
        </p>
      )}

      {payload && !payload.unavailable && book && (
        <ActiveBody
          payload={payload}
          book={book}
          filter={filter}
          setFilter={setFilter}
          query={query}
          setQuery={setQuery}
          lines={lines}
        />
      )}
    </section>
  );
}

function ActiveBody({
  payload,
  book,
  filter,
  setFilter,
  query,
  setQuery,
  lines,
}: {
  payload: ActivePayload;
  book: ActiveBook;
  filter: Filter;
  setFilter: (next: Filter) => void;
  query: string;
  setQuery: (next: string) => void;
  lines: ActiveBook["lines"];
}) {
  const notes = [
    ...payload.desks
      .filter((desk) => desk.ran && desk.suppressed)
      .map((desk) => `${desk.sleeve} is behind the latest session, so its open signals stay off this book.`),
    ...payload.desks
      .filter((desk) => desk.sleeve === "LOOP" && desk.stale && desk.ran)
      .map(() => "LOOP marks are behind the latest session. Open positions still show, matching the LOOP desk."),
    ...payload.desks.filter((desk) => !desk.ran).map((desk) => `${desk.sleeve} has no run yet.`),
  ];
  const flat = book.lines.length === 0;
  return (
    <>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        <Metric label="Gross" value={usd(book.gross)} />
        <Metric label="Net" value={usd(book.net)} className={tone(book.net)} />
        <Metric label="Long" value={usd(book.longGross)} />
        <Metric label="Short" value={usd(book.shortGross)} />
        <Metric label="Open P&L" value={book.pnl == null ? "—" : usd(book.pnl)} className={tone(book.pnl ?? 0)} />
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        Open P&L sums LOOP and ORB marks. CASH and ROTATE publish notional only.
      </p>

      <div className="mt-4 grid grid-cols-2 xl:grid-cols-4 gap-2">
        {book.sleeves.map((sleeve) => {
          const desk = payload.desks.find((row) => row.sleeve === sleeve.sleeve);
          return (
            <Link
              key={sleeve.sleeve}
              href={SLEEVE_HREF[sleeve.sleeve]}
              className="rounded-xl border border-[var(--panel-border)] px-3 py-2"
              style={{ borderTopColor: SLEEVE_COLOR[sleeve.sleeve], borderTopWidth: 2 }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium">{sleeve.sleeve}</span>
                <span className="font-terminal text-[11px] text-[var(--text-muted)]">
                  {sleeve.weight.toFixed(1)}%
                </span>
              </div>
              <p className="font-terminal text-sm mt-1">{usd(sleeve.gross)}</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                {sleeve.names === 0 && desk?.ran && !desk.suppressed
                  ? "Flat"
                  : `${sleeve.names} ${sleeve.names === 1 ? "name" : "names"}`}
                {desk?.asOf ? ` · ${desk.asOf}` : ""}
                {desk && !desk.ran ? " · no run" : ""}
              </p>
            </Link>
          );
        })}
      </div>

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-[var(--text-secondary)]">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {book.overlap.length > 0 && (
        <p className="mt-3 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-alt)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
          Held in more than one sleeve: {book.overlap.join(", ")}. Each line keeps its own notional.
        </p>
      )}

      {flat ? (
        <p className="mt-4 text-sm text-[var(--text-secondary)]">No open short-term trades.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap rounded-full bg-[var(--surface-alt)] p-1">
              {(["ALL", "LOOP", "ORB", "CASH", "ROTATE"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  className="pf-pill"
                  data-active={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {id === "ALL" ? "All" : id}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a ticker"
              aria-label="Find a ticker"
              className="w-36 rounded-full border border-[var(--panel-border)] bg-[var(--surface-alt)] px-3 py-1.5 text-[12px] outline-none focus:border-[var(--accent-info)]"
            />
            <span className="text-[11px] text-[var(--text-muted)]">
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </span>
          </div>
          <div className="mt-3 max-h-[420px] overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[var(--text-muted)] font-terminal sticky top-0 bg-[var(--panel-bg)]">
                <tr>
                  <th className="py-1 pr-3 font-normal">Sleeve</th>
                  <th className="py-1 pr-3 font-normal">Book</th>
                  <th className="py-1 pr-3 font-normal">Name</th>
                  <th className="py-1 pr-3 font-normal">Side</th>
                  <th className="py-1 pr-3 font-normal text-right">Notional</th>
                  <th className="py-1 pr-3 font-normal text-right">Weight</th>
                  <th className="py-1 pr-3 font-normal">As of</th>
                  <th className="py-1 pr-3 font-normal text-right">P&L</th>
                  <th className="py-1 font-normal text-right">Days</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-3 text-[var(--text-muted)]">
                      Nothing open{query.trim() ? ` for ${query.trim().toUpperCase()}` : filter === "ALL" ? "" : ` in ${filter}`}.
                    </td>
                  </tr>
                )}
                {lines.map((line) => (
                  <tr key={line.id} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: SLEEVE_COLOR[line.sleeve] }} />
                        {line.sleeve}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{BOOK_LABEL[line.book]}</td>
                    <td className="py-1.5 pr-3 font-medium">{line.symbol}</td>
                    <td className={`py-1.5 pr-3 font-terminal ${line.side === "LONG" ? "text-[var(--accent-bull)]" : "text-[var(--accent-bear)]"}`}>
                      {line.side}
                    </td>
                    <td className={`py-1.5 pr-3 text-right font-terminal ${tone(line.notional)}`}>{usd(line.notional)}</td>
                    <td className="py-1.5 pr-3 text-right font-terminal">{line.weight.toFixed(2)}%</td>
                    <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{line.asOf ?? "—"}</td>
                    <td className={`py-1.5 pr-3 text-right font-terminal ${tone(line.unrealizedPnlUsd ?? 0)}`}>
                      {line.unrealizedPnlUsd == null ? "—" : usd(line.unrealizedPnlUsd)}
                    </td>
                    <td className="py-1.5 text-right font-terminal text-[var(--text-secondary)]">
                      {line.daysHeld == null ? "—" : line.daysHeld}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {book.risk && (
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-xl border border-[var(--panel-border)] px-3 py-3">
          <div>
            <p className="pf-kicker">Studio read · 1Y gross mix</p>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)] max-w-2xl">
              Illustrative path for the {(book.risk.coveredWeight * 100).toFixed(0)}% of gross inside the 24-name studio universe. Those names are renormalized, and a short is sized by its absolute notional. The rest of the book stays in the table.
            </p>
            {book.risk.outside.length > 0 && book.risk.outside.length <= 8 && (
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">Outside the path: {book.risk.outside.join(", ")}.</p>
            )}
            {book.risk.outside.length > 8 && (
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                {book.risk.outside.length} names sit outside the studio universe and stay out of this path.
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Metric label="Growth of $10k" value={usd(book.risk.value)} />
              <Metric label="Ann. return" value={pct(book.risk.cagr)} className={tone(book.risk.cagr)} />
              <Metric label="Vol" value={pct(book.risk.vol, 1, false)} />
              <Metric label="Sharpe" value={book.risk.sharpe.toFixed(2)} />
              <Metric label="Max DD" value={pct(book.risk.maxDd)} className="text-[var(--accent-bear)]" />
            </div>
          </div>
          <Spark values={book.risk.spark} color={book.risk.value >= 10_000 ? "#22c55e" : "#fb7185"} />
        </div>
      )}
    </>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className={`font-terminal text-sm ${className ?? ""}`}>{value}</p>
    </div>
  );
}
