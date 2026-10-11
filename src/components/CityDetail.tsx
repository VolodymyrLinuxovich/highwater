"use client";

import type { CityCard } from "@/lib/board";
import { shortLabel } from "./Dashboard";

const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 && p > 0 ? 1 : 0)}%`;
const cents = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}¢`);

export default function CityDetail({ c, now, onClose }: { c: CityCard; now: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="h-full w-full max-w-3xl overflow-y-auto border-l border-line bg-panel p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{c.name}</h2>
            <p className="num text-xs text-muted">
              {c.ticker} · station {c.station} · {c.localTime} local · {c.hoursLeft}h of climate day left
            </p>
          </div>
          <button onClick={onClose} className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-foreground">
            Close
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat k="High so far" v={c.observedMax != null ? `${c.observedMax}°F` : "—"} tone="text-accent" />
          <Stat k="Median final" v={`${c.median}°F`} />
          <Stat k="80% range" v={`${c.p10}–${c.p90}°F`} />
          <Stat k="Forecast bias today" v={`${c.bias >= 0 ? "+" : ""}${c.bias}°F`} tone={c.bias >= 0 ? "text-accent" : "text-cool"} />
        </div>

        <Chart c={c} now={now} />

        <h3 className="mt-6 text-sm font-medium uppercase tracking-wider text-muted">Contracts</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-2 font-normal">Bin</th>
                <th className="pr-2 text-right font-normal">Highwater</th>
                <th className="pr-2 text-right font-normal">Forecast only</th>
                <th className="pr-2 text-right font-normal">Our bid / ask</th>
                <th className="pr-2 text-right font-normal">Market bid / ask</th>
                <th className="pr-2 text-right font-normal">Last</th>
                <th className="text-right font-normal">Signal</th>
              </tr>
            </thead>
            <tbody>
              {c.quotes.map((q) => (
                <tr key={q.symbol} className="border-b border-line/60">
                  <td className={`num py-2 pr-2 ${q.status === "dead" ? "text-muted line-through" : ""}`}>{shortLabel(q.label)}</td>
                  <td className="num pr-2 text-right font-semibold text-accent">{pct(q.fair)}</td>
                  <td className="num pr-2 text-right text-cool">{pct(q.forecastOnly)}</td>
                  <td className="num pr-2 text-right">
                    {cents(q.bid)} / {cents(q.ask)}
                  </td>
                  <td className="num pr-2 text-right text-muted">
                    {cents(q.market.bid)} / {cents(q.market.ask)}
                  </td>
                  <td className="num pr-2 text-right text-muted">{cents(q.market.last)}</td>
                  <td className="text-right text-xs">
                    {q.status === "dead" ? (
                      <span className="text-muted">impossible</span>
                    ) : q.edge ? (
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">
                        {q.edge.side} @ {cents(q.edge.price)} (+{Math.round(q.edge.size * 100)}¢)
                      </span>
                    ) : q.status === "locked" ? (
                      <span className="text-good">locked</span>
                    ) : (
                      <span className="text-muted">quote</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {c.lastObs && (
          <div className="mt-6">
            <h3 className="text-sm font-medium uppercase tracking-wider text-muted">Latest observation</h3>
            <code className="mt-2 block break-all rounded-md bg-background p-3 text-xs text-muted">{c.lastObs.raw}</code>
          </div>
        )}
      </aside>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3">
      <div className={`num text-lg font-semibold ${tone ?? ""}`}>{v}</div>
      <div className="text-xs text-muted">{k}</div>
    </div>
  );
}

function Chart({ c, now }: { c: CityCard; now: number }) {
  const W = 680;
  const H = 260;
  const L = 36;
  const R = 110;
  const T = 12;
  const B = 24;
  const t0 = c.window.start - 3 * 3_600_000;
  const t1 = c.window.end;
  const temps = [...c.obs.map((o) => o.f), ...c.fan.flatMap((f) => [f.p10, f.p90]), c.p10, c.p90].filter(Number.isFinite);
  const yMin = Math.floor(Math.min(...temps) - 2);
  const yMax = Math.ceil(Math.max(...temps) + 2);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (f: number) => T + (1 - (f - yMin) / (yMax - yMin)) * (H - T - B);

  const obs = c.obs.filter((o) => o.t >= t0 && o.t <= t1);
  const fan = c.fan.filter((f) => f.t <= t1);
  const band =
    fan.length > 1
      ? `M${fan.map((f) => `${x(f.t)},${y(f.p90)}`).join(" L")} L${[...fan].reverse().map((f) => `${x(f.t)},${y(f.p10)}`).join(" L")} Z`
      : "";
  const ticks: number[] = [];
  for (let f = Math.ceil(yMin / 5) * 5; f <= yMax; f += 5) ticks.push(f);
  const hours: number[] = [];
  for (let t = Math.ceil(t0 / 10_800_000) * 10_800_000; t <= t1; t += 10_800_000) hours.push(t);
  const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric" });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-5 w-full rounded-lg border border-line bg-background">
      {ticks.map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(f)} y2={y(f)} stroke="#1f2a36" />
          <text x={L - 6} y={y(f) + 3} textAnchor="end" fontSize="10" fill="#7d8b99">
            {f}°
          </text>
        </g>
      ))}
      {hours.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="#7d8b99">
          {fmt.format(t)}
        </text>
      ))}
      <rect x={x(t0)} y={T} width={x(c.window.start) - x(t0)} height={H - T - B} fill="#ffffff" opacity="0.03" />
      {band && <path d={band} fill="#4cc2ff" opacity="0.18" />}
      {fan.length > 1 && (
        <polyline points={fan.map((f) => `${x(f.t)},${y(f.p50)}`).join(" ")} fill="none" stroke="#4cc2ff" strokeWidth="1.5" strokeDasharray="4 3" />
      )}
      <polyline points={obs.map((o) => `${x(o.t)},${y(o.f)}`).join(" ")} fill="none" stroke="#e6edf3" strokeWidth="1.5" />
      {obs.map((o) => (
        <circle key={o.t} cx={x(o.t)} cy={y(o.f)} r="2" fill="#e6edf3" />
      ))}
      {c.observedMax != null && (
        <g>
          <line x1={x(c.window.start)} x2={W - R} y1={y(c.observedMax)} y2={y(c.observedMax)} stroke="#ff7a3d" strokeDasharray="3 3" />
          <text x={x(c.window.start) + 4} y={y(c.observedMax) - 4} fontSize="10" fill="#ff7a3d">
            high so far {c.observedMax}°
          </text>
        </g>
      )}
      {now > t0 && now < t1 && <line x1={x(now)} x2={x(now)} y1={T} y2={H - B} stroke="#7d8b99" strokeDasharray="2 3" />}
      {/* Distribution of the final high, drawn sideways on the right edge. */}
      {c.dist.map((d) => {
        const maxP = Math.max(...c.dist.map((v) => Math.max(v.p, v.fc)), 0.01);
        const yy = y(d.f);
        return (
          <g key={d.f}>
            <rect x={W - R + 8} y={yy - 2} width={(d.fc / maxP) * (R - 40)} height="4" fill="#4cc2ff" opacity="0.35" />
            <rect x={W - R + 8} y={yy - 2} width={(d.p / maxP) * (R - 40)} height="4" fill="#ff7a3d" />
          </g>
        );
      })}
      <text x={W - R + 8} y={T + 8} fontSize="10" fill="#7d8b99">
        final high
      </text>
    </svg>
  );
}
