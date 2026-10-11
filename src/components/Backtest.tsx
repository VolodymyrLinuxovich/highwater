"use client";

import { useEffect, useState } from "react";
import { pct } from "@/lib/format";
import { SectionTitle } from "./PageHeader";

type Score = { brier: number; logLoss: number; acc: number; pWin?: number };
type Real = {
  period: { start: string; end: string };
  events: number;
  cities: number;
  stationCheck: { city: string; station: string; agree: number; n: number }[];
  byAsOfHour: { hour: number; n: number; nowcast: Score; floorOnly: Score; forecastOnly: Score }[];
  dead: {
    ruledOut: number;
    resolvedNo: number;
    withTruncatedFloor?: { ruledOut: number; resolvedNo: number };
    floorCheck?: { cases: { station: string; date: string; metarMax: number; cliHigh: number }[] };
  };
  examples: { ticker: string; title: string; asOfHour: number; observedMax: number; winner: string; nowcastPWin: number; forecastPWin: number }[];
};
type BT = {
  stationDays: number;
  period: { start: string; end: string };
  stations: unknown[];
  byAsOfHour: { hour: number; n: number; nowcast: Score; forecastOnly: Score }[];
  calibration: { bucket: number; predicted: number; observed: number; n: number }[];
};

function useJson<T>(url: string) {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then(setV)
      .catch(() => setV(null));
  }, [url]);
  return v;
}

export default function Backtest() {
  const real = useJson<Real>("/realcontracts.json");
  const bt = useJson<BT>("/backtest.json");
  if (!real) return <div className="h-[400px] animate-pulse rounded-2xl border border-line bg-panel" />;

  const allAgree = real.stationCheck.filter((s) => s.agree === 1).length;
  const minN = Math.min(...real.stationCheck.map((s) => s.n));
  const dead = real.dead.withTruncatedFloor ?? real.dead;
  const roundingMisses = real.dead.ruledOut - real.dead.resolvedNo;
  const anc = real.dead.floorCheck?.cases?.[0];
  const at18 = real.byAsOfHour.find((r) => r.hour === 18) ?? real.byAsOfHour.at(-1)!;
  const gain = 1 - at18.nowcast.brier / at18.forecastOnly.brier;

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile big={`${dead.resolvedNo.toLocaleString("en-US")}/${dead.ruledOut.toLocaleString("en-US")}`} tone="text-accent" label="contracts we called impossible actually lost" />
        <Tile big={`${Math.round(gain * 100)}%`} tone="text-good" label="more accurate than the forecast alone, by 6pm" />
        <Tile big={`${allAgree}/${real.stationCheck.length}`} tone="text-cool" label="cities where we read the exact thermometer Gemini settles on" />
      </div>

      <SectionTitle title="How we tested it" />
      <ol className="grid gap-4 md:grid-cols-3">
        {[
          ["Rewind", `Take ${real.events} Gemini markets that already settled, across ${real.cities} cities.`],
          ["Only what was known", "Rebuild each day at noon, 3pm and 6pm using only the weather reports out by then."],
          ["Check the answer", "Score every probability against the contract Gemini actually paid out."],
        ].map(([title, body], i) => (
          <li key={title} className="rounded-2xl border border-line bg-panel p-6">
            <div className="num text-3xl font-semibold text-accent">{i + 1}</div>
            <div className="mt-2 text-lg font-medium">{title}</div>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>

      <SectionTitle title="It gets sharper as the day goes on">Average chance given to the range that actually won.</SectionTitle>
      <div className="space-y-5 rounded-2xl border border-line bg-panel p-6">
        {real.byAsOfHour.map((r) => (
          <div key={r.hour} className="grid grid-cols-[56px_1fr] items-center gap-4">
            <div className="num text-lg text-muted">{r.hour > 12 ? `${r.hour - 12}pm` : "noon"}</div>
            <div className="space-y-1.5">
              <Bar value={r.nowcast.pWin ?? 0} label="Highwater" color="bg-accent" />
              <Bar value={r.forecastOnly.pWin ?? 0} label="Forecast alone" color="bg-cool/60" />
            </div>
          </div>
        ))}
        <p className="text-sm text-muted">Before noon, little has happened yet, so Highwater is no better than the forecast and leans on it.</p>
      </div>

      {real.examples.length > 0 && (
        <>
          <SectionTitle title="Real days, wins and misses" />
          <div className="grid gap-4 md:grid-cols-3">
            {onePerCity(real.examples).map((e) => {
              const win = e.nowcastPWin >= e.forecastPWin;
              return (
                <div key={`${e.ticker}-${e.asOfHour}`} className="rounded-2xl border border-line bg-panel p-6">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-lg font-medium">{e.title.replace("Highest temperature in ", "").replace(/ on .*$/, "")}</div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs ${win ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>{win ? "win" : "miss"}</span>
                  </div>
                  <div className="mt-1 text-sm text-muted">{e.title.match(/ on (.*?)\??$/)?.[1]} · at {e.asOfHour > 12 ? `${e.asOfHour - 12}pm` : `${e.asOfHour}:00`}</div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className={`num text-4xl font-semibold ${win ? "text-accent" : "text-bad"}`}>{pct(e.nowcastPWin)}</span>
                    <span className="text-sm text-muted">on the winner</span>
                  </div>
                  <div className="mt-1 text-sm text-muted">
                    Forecast alone: <span className="num text-cool">{pct(e.forecastPWin)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <SectionTitle title="Details" />
      <div className="space-y-3">
        <Fold title="Full scores (Brier, lower is better)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 font-normal">As of (local)</th>
                  <th className="text-right font-normal">Highwater</th>
                  <th className="text-right font-normal">Floor only</th>
                  <th className="text-right font-normal">Forecast only</th>
                </tr>
              </thead>
              <tbody>
                {real.byAsOfHour.map((r) => (
                  <tr key={r.hour} className="border-b border-line/60 last:border-0">
                    <td className="num py-3">{r.hour}:00</td>
                    <td className="num text-right font-semibold text-good">{r.nowcast.brier.toFixed(3)}</td>
                    <td className="num text-right text-muted">{r.floorOnly.brier.toFixed(3)}</td>
                    <td className="num text-right text-cool">{r.forecastOnly.brier.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">
            {real.period.start} to {real.period.end}. &ldquo;Floor only&rdquo; just cuts the forecast at the high so far; it explains about half the gain.
          </p>
        </Fold>
        <Fold title="Why the two big checks matter">
          <p>
            <span className="text-foreground">Impossible means impossible.</span> Of {dead.ruledOut.toLocaleString("en-US")} contracts below the observed
            high, {dead.resolvedNo.toLocaleString("en-US")} settled NO.
            {roundingMisses > 0 && anc && (
              <>
                {" "}
                An earlier version rounded the reading and got {roundingMisses} wrong ({anc.station}, {anc.date}: {anc.metarMax}°F reported, {anc.cliHigh}°F
                official), so it now rounds down.
              </>
            )}
          </p>
          <p className="mt-2">
            <span className="text-foreground">The right thermometer.</span> Gemini names a city, not a station. For {allAgree} of{" "}
            {real.stationCheck.length} cities our station matched every settlement ({minN}+ days each). Nearby airports often don&apos;t.
          </p>
        </Fold>
        {bt && (
          <Fold title={`Longer backtest with mornings (${bt.stationDays} station-days)`}>
            <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 font-normal">As of</th>
                    <th className="text-right font-normal">Highwater</th>
                    <th className="text-right font-normal">Forecast only</th>
                  </tr>
                </thead>
                <tbody>
                  {bt.byAsOfHour.map((r) => (
                    <tr key={r.hour} className="border-b border-line/60 last:border-0">
                      <td className="num py-2.5">{r.hour}:00</td>
                      <td className={`num text-right font-semibold ${r.nowcast.brier < r.forecastOnly.brier ? "text-good" : "text-bad"}`}>{r.nowcast.brier.toFixed(3)}</td>
                      <td className="num text-right text-cool">{r.forecastOnly.brier.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Calibration rows={bt.calibration} />
            </div>
          </Fold>
        )}
        <Fold title="Caveats">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Historical forecasts are stitched short-range runs, which makes the forecast-only baseline look better than a real day-ahead forecast.</li>
            <li>The forecast spread and the peak allowance were fitted on the same days that are scored.</li>
            <li>The longer backtest uses synthetic 2°F ranges, not Gemini&apos;s strikes.</li>
            <li>These are replays, not live trading results.</li>
          </ul>
        </Fold>
      </div>
    </div>
  );
}

function Bar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-6 flex-1 overflow-hidden rounded-md bg-background">
        <div className={`h-full rounded-md ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <div className="w-36 text-sm">
        <span className="num font-semibold">{pct(value)}</span> <span className="text-muted">{label}</span>
      </div>
    </div>
  );
}

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-line bg-panel p-5 text-sm leading-relaxed text-muted">
      <summary className="cursor-pointer list-none text-base font-medium text-foreground">
        <span className="mr-2 inline-block text-accent transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function onePerCity(xs: Real["examples"]) {
  const seen = new Set<string>();
  return xs
    .filter((e) => {
      const city = e.ticker.split("-")[1];
      if (seen.has(city)) return false;
      seen.add(city);
      return true;
    })
    .slice(0, 3);
}

function Tile({ big, label, tone }: { big: string; label: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <div className={`num text-4xl font-semibold sm:text-5xl ${tone}`}>{big}</div>
      <div className="mt-2 text-[15px] leading-snug text-muted">{label}</div>
    </div>
  );
}

function Calibration({ rows }: { rows: BT["calibration"] }) {
  const S = 220;
  const P = 28;
  const x = (v: number) => P + v * (S - 2 * P);
  const y = (v: number) => S - P - v * (S - 2 * P);
  const pts = rows.filter((r) => r.n >= 20);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
      <svg viewBox={`0 0 ${S} ${S}`} className="w-44 shrink-0 rounded-lg bg-background">
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#1f2a36" strokeDasharray="3 3" />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(0)} stroke="#1f2a36" />
        <line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(1)} stroke="#1f2a36" />
        <polyline points={pts.map((r) => `${x(r.predicted)},${y(r.observed)}`).join(" ")} fill="none" stroke="#ff7a3d" strokeWidth="1.5" />
        {pts.map((r) => (
          <circle key={r.bucket} cx={x(r.predicted)} cy={y(r.observed)} r={2 + Math.min(4, Math.log10(r.n))} fill="#ff7a3d" />
        ))}
        <text x={S / 2} y={S - 8} textAnchor="middle" fontSize="10" fill="#7d8b99">
          predicted
        </text>
        <text x={10} y={S / 2} textAnchor="middle" fontSize="10" fill="#7d8b99" transform={`rotate(-90 10 ${S / 2})`}>
          observed
        </text>
      </svg>
      <p className="text-sm leading-relaxed text-muted">
        <span className="text-foreground">Calibration.</span> When Highwater says 70%, it happens about 70% of the time: the dots
        sit near the diagonal. Dot size shows how many contracts fell in each bucket.
      </p>
    </div>
  );
}
