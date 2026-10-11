"use client";

import { useEffect, useState } from "react";

type Score = { brier: number; logLoss: number; acc: number };
type BT = {
  stationDays: number;
  period?: { start: string; end: string } | string;
  stations: (string | { id: string })[];
  byAsOfHour: { hour: number; n: number; nowcast: Score; forecastOnly: Score }[];
  calibration: { bucket: number; predicted: number; observed: number; n: number }[];
  notes?: string | string[];
};

export default function Backtest() {
  const [bt, setBt] = useState<BT | null>(null);
  useEffect(() => {
    fetch("/backtest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setBt)
      .catch(() => setBt(null));
  }, []);
  if (!bt) return null;

  const period = typeof bt.period === "string" ? bt.period : bt.period ? `${bt.period.start} to ${bt.period.end}` : "";
  return (
    <section className="mt-10 border-t border-line pt-6">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Does it work? Backtest against official NWS highs</h2>
      <p className="mt-1 text-sm text-muted">
        {bt.stationDays} station-days, {bt.stations.length} stations, {period}. Each day is replayed as of a local hour using
        only the METARs available then, scored on 7 Gemini-style bins. Lower Brier is better.
      </p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">As of</th>
              <th className="text-right font-normal">Brier: Highwater</th>
              <th className="text-right font-normal">forecast only</th>
              <th className="text-right font-normal">Top-bin hit rate</th>
            </tr>
          </thead>
          <tbody>
            {bt.byAsOfHour.map((r) => {
              const better = r.nowcast.brier < r.forecastOnly.brier;
              return (
                <tr key={r.hour} className="border-b border-line/60">
                  <td className="num py-2">{r.hour}:00</td>
                  <td className={`num text-right font-semibold ${better ? "text-good" : "text-bad"}`}>{r.nowcast.brier.toFixed(3)}</td>
                  <td className="num text-right text-cool">{r.forecastOnly.brier.toFixed(3)}</td>
                  <td className="num text-right">
                    {Math.round(r.nowcast.acc * 100)}% <span className="text-muted">vs {Math.round(r.forecastOnly.acc * 100)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Calibration rows={bt.calibration} />
      </div>
      <p className="mt-3 text-xs text-muted">
        Before noon the observed max says little, so the live engine blends toward the forecast-only model from 9:00 to 12:00
        local standard time. Caveat: the historical forecasts are short-lead model runs, which flatters the baseline.
      </p>
    </section>
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
      <svg viewBox={`0 0 ${S} ${S}`} className="w-56 shrink-0 rounded-lg border border-line bg-background">
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
        Calibration: when Highwater says 70%, it happens about 70% of the time. Dots sit on the diagonal; size shows how many
        contracts fell in each bucket.
      </p>
    </div>
  );
}
