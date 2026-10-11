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
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile big={`${Math.round(gain * 100)}%`} tone="text-good" label={`lower Brier score than the forecast alone at 6pm (${at18.nowcast.brier.toFixed(3)} vs ${at18.forecastOnly.brier.toFixed(3)})`} />
        <Tile
          big={`${dead.resolvedNo.toLocaleString("en-US")} / ${dead.ruledOut.toLocaleString("en-US")}`}
          tone="text-accent"
          label="contracts Highwater called impossible that settled NO"
        />
        <Tile big={`${allAgree} / ${real.stationCheck.length}`} tone="text-cool" label={`cities where our weather station matched every Gemini settlement (${minN}+ days each)`} />
      </div>

      <SectionTitle title="Scored on real Gemini markets">
        {real.events} markets that already settled, {real.cities} cities, {real.period.start} to {real.period.end}. Each day is
        rebuilt as of a local hour using only the weather reports available then, and scored against the contract Gemini
        settled YES.
      </SectionTitle>
      <div className="rounded-2xl border border-line bg-panel p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2 font-normal">As of (local)</th>
                <th className="text-right font-normal">Highwater</th>
                <th className="text-right font-normal">Floor only</th>
                <th className="text-right font-normal">Forecast only</th>
                <th className="text-right font-normal">Avg. probability on the winner</th>
              </tr>
            </thead>
            <tbody>
              {real.byAsOfHour.map((r) => (
                <tr key={r.hour} className="border-b border-line/60 last:border-0">
                  <td className="num py-3">{r.hour}:00</td>
                  <td className="num text-right font-semibold text-good">{r.nowcast.brier.toFixed(3)}</td>
                  <td className="num text-right text-muted">{r.floorOnly.brier.toFixed(3)}</td>
                  <td className="num text-right text-cool">{r.forecastOnly.brier.toFixed(3)}</td>
                  <td className="num text-right">
                    {pct(r.nowcast.pWin ?? 0)} <span className="text-muted">vs {pct(r.forecastOnly.pWin ?? 0)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-3 text-xs leading-relaxed text-muted sm:grid-cols-3">
          <p>
            <span className="text-foreground">Brier score</span> measures how far the probabilities were from what happened.
            Lower is better; 0 is perfect.
          </p>
          <p>
            <span className="text-foreground">Floor only</span> takes the forecast and just cuts it at the high so far. It
            accounts for roughly half of Highwater&apos;s improvement.
          </p>
          <p>
            <span className="text-foreground">Avg. probability on the winner</span> is the average chance given to the
            contract that actually paid out.
          </p>
        </div>
      </div>

      <SectionTitle title="Two checks that matter for trading" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-panel p-5 text-sm leading-relaxed text-muted">
          <h3 className="font-medium text-foreground">&ldquo;Impossible&rdquo; means impossible</h3>
          <p className="mt-1.5">
            Of {dead.ruledOut.toLocaleString("en-US")} contracts below the observed floor, {dead.resolvedNo.toLocaleString("en-US")}{" "}
            settled NO.
            {roundingMisses > 0 && anc && (
              <>
                {" "}
                An earlier version rounded the reported maximum and got {roundingMisses} wrong ({anc.station} on {anc.date}:
                reports peaked at {anc.metarMax}°F, the official high was {anc.cliHigh}°F), so the floor now rounds down.
              </>
            )}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5 text-sm leading-relaxed text-muted">
          <h3 className="font-medium text-foreground">The right thermometer</h3>
          <p className="mt-1.5">
            Gemini&apos;s contract text names a city, not a station. For {allAgree} of {real.stationCheck.length} cities, the
            official high at our mapped station fell in the contract Gemini settled YES on every day checked. Nearby stations
            often don&apos;t: the control comparison is in <span className="num">public/realcontracts.json</span>.
          </p>
        </div>
      </div>

      {bt && (
        <>
          <SectionTitle title="Longer window, including mornings">
            A second backtest covers {bt.stationDays} station-days at {bt.stations.length} stations ({bt.period.start} to{" "}
            {bt.period.end}) on synthetic 2°F ranges. It shows where Highwater is weaker: at 9:00 little has been observed yet, so
            the live engine leans on the forecast until noon.
          </SectionTitle>
          <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
            <div className="overflow-x-auto rounded-2xl border border-line bg-panel p-5">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 font-normal">As of</th>
                    <th className="text-right font-normal">Highwater</th>
                    <th className="text-right font-normal">Forecast only</th>
                    <th className="text-right font-normal">Top pick right</th>
                  </tr>
                </thead>
                <tbody>
                  {bt.byAsOfHour.map((r) => {
                    const better = r.nowcast.brier < r.forecastOnly.brier;
                    return (
                      <tr key={r.hour} className="border-b border-line/60 last:border-0">
                        <td className="num py-3">{r.hour}:00</td>
                        <td className={`num text-right font-semibold ${better ? "text-good" : "text-bad"}`}>{r.nowcast.brier.toFixed(3)}</td>
                        <td className="num text-right text-cool">{r.forecastOnly.brier.toFixed(3)}</td>
                        <td className="num text-right">
                          {pct(r.nowcast.acc)} <span className="text-muted">vs {pct(r.forecastOnly.acc)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="rounded-2xl border border-line bg-panel p-5">
              <Calibration rows={bt.calibration} />
            </div>
          </div>
        </>
      )}

      {real.examples.length > 0 && (
        <>
          <SectionTitle title="Examples, wins and misses" />
          <div className="grid gap-3 md:grid-cols-3">
            {onePerCity(real.examples).map((e) => {
              const win = e.nowcastPWin >= e.forecastPWin;
              return (
                <div key={`${e.ticker}-${e.asOfHour}`} className="rounded-2xl border border-line bg-panel p-5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{e.title.replace("Highest temperature in ", "").replace("?", "")}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${win ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>{win ? "win" : "miss"}</span>
                  </div>
                  <div className="num mt-0.5 text-xs text-muted">
                    as of {e.asOfHour}:00 · high so far {e.observedMax}° · settled {e.winner}
                  </div>
                  <div className="mt-3 flex items-baseline gap-3">
                    <span className={`num text-2xl font-semibold ${win ? "text-accent" : "text-bad"}`}>{pct(e.nowcastPWin)}</span>
                    <span className="text-xs text-muted">
                      Highwater vs <span className="num text-cool">{pct(e.forecastPWin)}</span> forecast alone
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <SectionTitle title="Caveats" />
      <ul className="max-w-3xl list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
        <li>The historical forecasts are stitched from the first hours of each model run, so the forecast-only baseline behaves like a short-range forecast and looks better than a real day-ahead forecast would.</li>
        <li>The forecast-only spread and the allowance for a peak between reports were fitted on the same days that are scored.</li>
        <li>The longer backtest uses synthetic 2°F ranges, not Gemini&apos;s actual strikes.</li>
        <li>These are replays, not live trading results. No market prices from those days are included.</li>
      </ul>
    </div>
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
    <div className="rounded-2xl border border-line bg-panel p-5">
      <div className={`num text-3xl font-semibold ${tone}`}>{big}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
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
