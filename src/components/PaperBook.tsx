"use client";

import { useEffect, useState } from "react";
import type { PaperBook as Book } from "@/lib/paper-book";
import { SectionTitle } from "./PageHeader";

const cents = (p: number) => `${Math.round(p * 100)}¢`;
const usd = (x: number) => `${x < 0 ? "−" : "+"}$${Math.abs(x).toFixed(2)}`;
const time = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default function PaperBook() {
  const [book, setBook] = useState<(Book & { error?: string }) | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/paper", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => alive && setBook(j))
        .catch(() => null);
    const first = setTimeout(load, 0);
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const fills = [...(book?.fills ?? [])].reverse().slice(0, 12);
  const positions = Object.entries(book?.positions ?? {})
    .map(([symbol, p]) => ({ symbol, ...p, mark: p.cash + p.qty * p.fair }))
    .sort((a, b) => Math.abs(b.mark) - Math.abs(a.mark))
    .slice(0, 8);

  return (
    <section>
      <SectionTitle title="Today's paper book on Gemini">
        Highwater rests a two-sided quote on every daily high contract against Gemini&apos;s real order books. A quote fills only
        when Gemini&apos;s best bid or ask crosses it, and every position is marked at Highwater&apos;s current fair value. Paper
        only: nothing is sent to Gemini.
      </SectionTitle>
      {!book ? (
        <p className="text-sm text-muted">Loading the book…</p>
      ) : book.error ? (
        <p className="text-sm text-bad">Paper book unavailable ({book.error.replace("Error: ", "")}).</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Quotes resting", `${book.resting.bids + book.resting.asks}`, `on ${book.resting.contracts} contracts · ${book.resting.marketQuoted} have a Gemini quote`],
              ["Fills today", `${book.fills.length}`, `${book.exposure} contract${book.exposure === 1 ? "" : "s"} held`],
              ["P&L at fair", usd(book.pnl), "cash + position × fair"],
              ["Edge at fill", usd(book.edgeAtFill), "fair minus price paid, summed"],
            ].map(([k, v, sub]) => (
              <div key={k} className="rounded-xl border border-line bg-panel p-4">
                <div className="text-xs text-muted">{k}</div>
                <div className="num mt-1 text-2xl font-semibold">{v}</div>
                <div className="mt-1 text-xs text-muted">{sub}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-panel p-4">
              <div className="mb-2 text-sm font-medium">Recent fills</div>
              {fills.length === 0 ? (
                <p className="text-xs text-muted">No crossings yet. Gemini&apos;s weather books are thin, so fills are rare and each one is a real mispricing.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="text-left font-normal">Time</th>
                      <th className="text-left font-normal">Contract</th>
                      <th className="text-right font-normal">Trade</th>
                      <th className="text-right font-normal">Fair</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fills.map((f, i) => (
                      <tr key={i}>
                        <td className="num text-muted">{time(f.t)}</td>
                        <td>
                          {f.city} · {f.label}
                        </td>
                        <td className={`num text-right ${f.side === "buy" ? "text-good" : "text-bad"}`}>
                          {f.side === "buy" ? "Buy" : "Sell"} YES {cents(f.price)}
                        </td>
                        <td className="num text-right text-accent">{cents(f.fair)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="rounded-xl border border-line bg-panel p-4">
              <div className="mb-2 text-sm font-medium">Positions</div>
              {positions.length === 0 ? (
                <p className="text-xs text-muted">Flat.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="text-left font-normal">Contract</th>
                      <th className="text-right font-normal">YES held</th>
                      <th className="text-right font-normal">Fair</th>
                      <th className="text-right font-normal">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.symbol}>
                        <td>
                          {p.city} · {p.label}
                        </td>
                        <td className="num text-right">{p.qty > 0 ? `+${p.qty}` : p.qty}</td>
                        <td className="num text-right text-accent">{cents(p.fair)}</td>
                        <td className={`num text-right ${p.mark >= 0 ? "text-good" : "text-bad"}`}>{usd(p.mark)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Running since {time(book.startedAt)} · {book.ticks} updates · last {time(book.updatedAt)} · one contract per fill and price level, at most 3 per contract
          </p>
        </>
      )}
    </section>
  );
}
