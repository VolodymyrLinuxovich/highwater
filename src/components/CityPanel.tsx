"use client";

import type { CityCard } from "@/lib/board";
import { shortLabel } from "@/lib/format";
import HighwaterChart from "./HighwaterChart";

const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 && p > 0 ? 1 : 0)}%`;
const cents = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}¢`);

// Everything about one city: stats, its day on the high-water chart, and every contract.
export default function CityPanel({ c, now }: { c: CityCard; now: number }) {
  const dead = c.quotes.filter((q) => q.status === "dead").length;
  const edges = c.quotes.filter((q) => q.edge).length;

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-panel p-5" aria-label={`${c.name} details`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{c.name}</h2>
          <p className="num mt-0.5 text-xs text-muted">
            {c.station} · {c.localTime} local · {c.hoursLeft}h of climate day left
          </p>
        </div>
        <div className="mr-9 text-right">
          <div className="num text-4xl font-semibold leading-none text-accent">
            {c.observedMax != null ? `${Math.round(c.observedMax)}°` : "—"}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">high so far</div>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-4 divide-x divide-line border-y border-line py-3 text-center">
        <Stat k="Median final" v={`${c.median}°`} />
        <Stat k="80% range" v={`${c.p10}–${c.p90}°`} />
        <Stat k="Forecast bias" v={`${c.bias >= 0 ? "+" : ""}${c.bias}°`} tone={c.bias >= 0 ? "text-accent" : "text-cool"} />
        <Stat k="Ruled out" v={`${dead}/${c.quotes.length}`} />
      </dl>

      <div className="mt-4">
        <HighwaterChart c={c} now={now} showList={false} />
      </div>

      <div className="mt-5 flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Contracts</h3>
        <span className="text-xs text-muted">{edges ? `${edges} market edge${edges > 1 ? "s" : ""} ≥ 5¢` : "no market edges ≥ 5¢"}</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[440px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-2 font-normal">Range</th>
              <th className="pr-2 text-right font-normal">Highwater</th>
              <th className="pr-2 text-right font-normal">Forecast</th>
              <th className="pr-2 text-right font-normal">Our quote</th>
              <th className="pr-2 text-right font-normal">Market</th>
              <th className="text-right font-normal">Signal</th>
            </tr>
          </thead>
          <tbody>
            {[...c.quotes].reverse().map((q) => (
              <tr key={q.symbol} className={`border-b border-line/60 last:border-0 ${q.status === "dead" ? "text-muted/60" : ""}`}>
                <td className={`num py-2 pr-2 ${q.status === "dead" ? "line-through" : ""}`}>{shortLabel(q.label)}</td>
                <td className="num pr-2 text-right font-semibold text-accent">{q.status === "dead" ? "0%" : pct(q.fair)}</td>
                <td className="num pr-2 text-right text-cool">{pct(q.forecastOnly)}</td>
                <td className="num pr-2 text-right">
                  {cents(q.bid)}/{cents(q.ask)}
                </td>
                <td className="num pr-2 text-right text-muted">
                  {cents(q.market.bid)}/{cents(q.market.ask)}
                </td>
                <td className="text-right text-xs">
                  {q.status === "dead" ? (
                    <span>out</span>
                  ) : q.edge ? (
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">
                      {q.edge.side} @ {cents(q.edge.price)}
                    </span>
                  ) : q.status === "locked" ? (
                    <span className="text-good">locked</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {c.lastObs && (
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer hover:text-foreground">Latest weather report</summary>
          <code className="mt-2 block break-all rounded-md bg-background p-3">{c.lastObs.raw}</code>
        </details>
      )}
    </section>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="px-1">
      <dd className={`num text-lg font-semibold ${tone ?? ""}`}>{v}</dd>
      <dt className="text-[11px] text-muted">{k}</dt>
    </div>
  );
}
