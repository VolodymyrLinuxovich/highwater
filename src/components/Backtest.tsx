"use client";

import { useEffect, useState } from "react";

type Score = { brier: number; logLoss: number; acc: number; pWin?: number };
type Real = {
  period: { start: string; end: string };
  events: number;
  cities: number;
  stationCheck: { city: string; station: string; agree: number; n: number }[];
  byAsOfHour: { hour: number; n: number; nowcast: Score; floorOnly: Score; forecastOnly: Score }[];
  dead: { ruledOut: number; resolvedNo: number; withTruncatedFloor?: { ruledOut: number; resolvedNo: number } };
  examples: { ticker: string; title: string; asOfHour: number; observedMax: number; winner: string; nowcastPWin: number; forecastPWin: number }[];
};
type BT = { calibration: { bucket: number; predicted: number; observed: number; n: number }[] };

const pct = (p: number) => `${Math.round(p * 100)}%`;

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
  if (!real) return null;

  const allAgree = real.stationCheck.every((s) => s.agree === 1);
  const minN = Math.min(...real.stationCheck.map((s) => s.n));
  const dead = real.dead.withTruncatedFloor ?? real.dead;
  const at18 = real.byAsOfHour.find((r) => r.hour === 18) ?? real.byAsOfHour.at(-1)!;
  const gain = 1 - at18.nowcast.brier / at18.forecastOnly.brier;

  return (
    <section className="mt-14">
      <h2 className="text-lg font-semibold tracking-tight">Does it work?</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Replayed against {real.events} real Gemini contracts that have already settled ({real.cities} cities,{" "}
        {real.period.start} to {real.period.end}). Each day is rebuilt as of a local hour using only the METARs available
        then, and scored against Gemini&apos;s official YES contract.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Tile big={`${Math.round(gain * 100)}%`} tone="text-good" label={`lower Brier than the forecast alone at 6pm (${at18.nowcast.brier.toFixed(3)} vs ${at18.forecastOnly.brier.toFixed(3)})`} />
        <Tile
          big={`${dead.resolvedNo.toLocaleString()} / ${dead.ruledOut.toLocaleString()}`}
          tone="text-accent"
          label="contracts Highwater called impossible that settled NO"
        />
        <Tile
          big={allAgree ? `${real.stationCheck.length} / ${real.stationCheck.length}` : `${real.stationCheck.filter((s) => s.agree === 1).length} / ${real.stationCheck.length}`}
          tone="text-cool"
          label={`cities where our NWS station matches every Gemini settlement (≥${minN} days each)`}
        />
      </div>

      <div className="mt-3 grid gap-6 rounded-xl border border-line bg-panel p-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2 font-normal">As of</th>
                <th className="text-right font-normal">Highwater</th>
                <th className="text-right font-normal">Floor only</th>
                <th className="text-right font-normal">Forecast only</th>
                <th className="text-right font-normal">P(winner)</th>
              </tr>
            </thead>
            <tbody>
              {real.byAsOfHour.map((r) => (
                <tr key={r.hour} className="border-b border-line/60 last:border-0">
                  <td className="num py-2.5">{r.hour}:00</td>
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
          <p className="mt-3 text-xs text-muted">
            Brier score, lower is better. &ldquo;Floor only&rdquo; just cuts the forecast at the high so far; it explains
            about half the gain. P(winner) is the average probability given to the contract that settled YES.
          </p>
        </div>
        {bt && <Calibration rows={bt.calibration} />}
      </div>

      {real.examples.length > 0 && (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {onePerCity(real.examples).map((e) => (
            <div key={`${e.ticker}-${e.asOfHour}`} className="rounded-xl border border-line bg-panel p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{e.title.replace("Highest temperature in ", "").replace("?", "")}</div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${e.nowcastPWin >= e.forecastPWin ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
                  {e.nowcastPWin >= e.forecastPWin ? "win" : "miss"}
                </span>
              </div>
              <div className="num mt-0.5 text-xs text-muted">
                as of {e.asOfHour}:00 · high so far {e.observedMax}° · settled {e.winner}
              </div>
              <div className="mt-3 flex items-baseline gap-4">
                <span className={`num text-2xl font-semibold ${e.nowcastPWin >= e.forecastPWin ? "text-accent" : "text-bad"}`}>{pct(e.nowcastPWin)}</span>
                <span className="text-xs text-muted">
                  Highwater vs <span className="num text-cool">{pct(e.forecastPWin)}</span> forecast alone
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-muted">
        Caveats: the historical forecasts are short-lead model runs, which flatters the forecast-only baseline; the
        forecast-only spread and peak allowance were fitted on the same days. Before noon the observed max says little, so
        the live engine blends toward the forecast from 9:00 to 12:00 local standard time.
      </p>
    </section>
  );
}

// One example per city, wins and misses alike.
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
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className={`num text-2xl font-semibold ${tone}`}>{big}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
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
    <div className="flex items-center gap-4">
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
      <p className="text-sm text-muted">
        Calibrated: when Highwater says 70%, it happens about 70% of the time. Dot size shows how many contracts fell in
        each bucket.
      </p>
    </div>
  );
}
