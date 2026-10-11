"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CityCard } from "@/lib/board";
import { pct, shortLabel } from "@/lib/format";

// One city's climate day as an instrument: observed temperatures, the running
// maximum (the high-water mark), Gemini's contract ranges as bands that go dead
// once the mark passes them, the forecast fan for the rest of the day, and
// Highwater's probability for each band.

const GUTTER = 190; // right column for range labels and probabilities (wide layout)

type Band = { label: string; y0: number; y1: number; fair: number; dead: boolean; lead: boolean; symbol: string };

export default function HighwaterChart({ c, now }: { c: CityCard; now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wide = width >= 680;
  const H = wide ? 420 : 300;
  const L = 44;
  const R = wide ? GUTTER : 12;
  const T = 18;
  const B = 30;

  const model = useMemo(() => {
    const { start, end } = c.window;
    const obs = c.obs.filter((o) => o.t >= start && o.t <= Math.min(end, now));
    const fan = c.fan.filter((f) => f.t > now && f.t <= end);
    const lead = [...c.quotes].sort((a, b) => b.fair - a.fair)[0];
    const finite = c.quotes.flatMap((q) => [q.bin.lo, q.bin.hi]).filter((v): v is number => v != null);
    const temps = [...obs.map((o) => o.f), ...fan.flatMap((f) => [f.p10, f.p90])];
    let yMin = Math.min(...temps, Math.min(...finite) - 3);
    let yMax = Math.max(...temps, Math.max(...finite) + 3);
    if (yMax - yMin < 14) {
      const mid = (yMax + yMin) / 2;
      yMin = mid - 7;
      yMax = mid + 7;
    }
    yMin = Math.floor(yMin);
    yMax = Math.ceil(yMax);
    const bands: Band[] = c.quotes.map((q) => ({
      label: q.label,
      symbol: q.symbol,
      y0: q.bin.lo == null ? yMin : q.bin.lo - 0.5,
      y1: q.bin.hi == null ? yMax : q.bin.hi + 0.5,
      fair: q.fair,
      dead: q.status === "dead",
      lead: q === lead,
    }));
    // Running maximum: the high-water mark only ever steps up.
    const steps: { t: number; f: number }[] = [];
    let m = -Infinity;
    for (const o of obs) {
      if (o.f > m) {
        m = o.f;
        steps.push({ t: o.t, f: o.f });
      }
    }
    return { start, end, obs, fan, bands, steps, yMin, yMax, lead };
  }, [c, now]);

  const { start, end, obs, fan, bands, steps, yMin, yMax } = model;
  const x = (t: number) => L + ((t - start) / (end - start)) * (width - L - R);
  const y = (f: number) => T + (1 - (f - yMin) / (yMax - yMin)) * (H - T - B);
  const nowX = x(Math.min(Math.max(now, start), end));
  const fmtHour = new Intl.DateTimeFormat("en-US", { timeZone: c.timeZone, hour: "numeric" });
  const hours: number[] = [];
  const stepH = wide ? 3 : 6;
  for (let t = Math.ceil(start / 3_600_000) * 3_600_000; t <= end; t += 3_600_000) {
    if (Math.round((t - start) / 3_600_000) % stepH === 0) hours.push(t);
  }
  const ticks: number[] = [];
  for (let f = Math.ceil(yMin / 5) * 5; f <= yMax; f += 5) ticks.push(f);

  // Step path for the high-water mark, carried forward to now.
  let markPath = "";
  steps.forEach((s, i) => {
    markPath += i === 0 ? `M${x(s.t)},${y(s.f)}` : ` H${x(s.t)} V${y(s.f)}`;
  });
  if (steps.length) markPath += ` H${nowX}`;
  const mark = c.observedMax;
  // The forecast leaves from the latest reading, not from the mark.
  const startF = obs.at(-1)?.f ?? fan[0]?.p50;
  const fanArea =
    fan.length > 1 && startF != null
      ? `M${nowX},${y(startF)} ` +
        fan.map((f) => `L${x(f.t)},${y(f.p90)}`).join(" ") +
        " " +
        [...fan].reverse().map((f) => `L${x(f.t)},${y(f.p10)}`).join(" ") +
        " Z"
      : "";

  return (
    <div>
      <div ref={ref} className="w-full">
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`${c.name}: observed temperatures and contract probabilities today`}>
          <defs>
            <pattern id="hw-dead" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="7" stroke="#2a3644" strokeWidth="2" />
            </pattern>
            <clipPath id="hw-plot">
              <rect x={L} y={T} width={width - L - R} height={H - T - B} />
            </clipPath>
          </defs>

          {/* Contract ranges as horizontal bands */}
          <g clipPath="url(#hw-plot)">
            {bands.map((b, i) => {
              const top = y(Math.min(b.y1, yMax));
              const bot = y(Math.max(b.y0, yMin));
              return (
                <g key={b.symbol}>
                  <rect x={L} y={top} width={width - L - R} height={Math.max(0, bot - top)} fill={b.dead ? "url(#hw-dead)" : i % 2 ? "#0c1117" : "#0f151d"} />
                  {b.lead && <rect x={L} y={top} width={width - L - R} height={Math.max(0, bot - top)} fill="#ff7a3d" opacity="0.07" />}
                  <line x1={L} x2={width - R} y1={top} y2={top} stroke="#1a2430" />
                </g>
              );
            })}
          </g>

          {/* Axes */}
          {ticks.map((f) => (
            <text key={f} x={L - 8} y={y(f) + 4} textAnchor="end" fontSize="11" fill="#7d8b99" className="num">
              {f}°
            </text>
          ))}
          {hours.map((t) => (
            <text key={t} x={x(t)} y={H - 10} textAnchor="middle" fontSize="11" fill="#7d8b99">
              {fmtHour.format(t)}
            </text>
          ))}

          {/* Forecast for the hours still to come */}
          {fanArea && <path d={fanArea} fill="#4cc2ff" opacity="0.16" clipPath="url(#hw-plot)" />}
          {fan.length > 1 && (
            <polyline
              points={[...(startF != null ? [`${nowX},${y(startF)}`] : []), ...fan.map((f) => `${x(f.t)},${y(f.p50)}`)].join(" ")}
              fill="none"
              stroke="#4cc2ff"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              clipPath="url(#hw-plot)"
            />
          )}

          {/* Observed temperatures */}
          {obs.length > 1 && (
            <path
              className="hw-draw"
              pathLength={1}
              d={obs.map((o, i) => `${i ? "L" : "M"}${x(o.t)},${y(o.f)}`).join(" ")}
              fill="none"
              stroke="#e6edf3"
              strokeOpacity="0.55"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          )}

          {/* The high-water mark, then the floor it sets for the rest of the day */}
          {markPath && <path className="hw-draw hw-draw-late" pathLength={1} d={markPath} fill="none" stroke="#ff7a3d" strokeWidth="2.5" strokeLinejoin="round" />}
          {mark != null && (
            <>
              <line x1={nowX} x2={width - R} y1={y(mark)} y2={y(mark)} stroke="#ff7a3d" strokeWidth="1.5" strokeDasharray="2 4" />
              <circle cx={nowX} cy={y(mark)} r="4.5" fill="#ff7a3d" className="hw-pulse" />
              <text
                x={nowX + 140 > width - R ? nowX - 10 : nowX + 8}
                y={y(mark) - 9}
                textAnchor={nowX + 140 > width - R ? "end" : "start"}
                fontSize="12"
                fill="#ff7a3d"
                className="num"
              >
                high-water mark {Math.round(mark)}°
              </text>
            </>
          )}

          {/* Now */}
          <line x1={nowX} x2={nowX} y1={T} y2={H - B} stroke="#7d8b99" strokeDasharray="2 3" />
          <text x={nowX} y={T - 5} textAnchor="middle" fontSize="11" fill="#e6edf3">
            now · {c.localTime}
          </text>

          {/* Probabilities per band (wide layout) */}
          {wide &&
            bands.map((b) => {
              const top = y(Math.min(b.y1, yMax));
              const bot = y(Math.max(b.y0, yMin));
              const cy = (top + bot) / 2;
              if (bot - top < 12) return null;
              const bx = width - R + 14;
              return (
                <g key={b.symbol} opacity={b.dead ? 0.45 : 1}>
                  <text x={bx} y={cy + 4} fontSize="12" fill={b.lead ? "#e6edf3" : "#9aa7b4"} className="num">
                    {shortLabel(b.label)}
                  </text>
                  {b.dead ? (
                    <text x={width - 12} y={cy + 4} textAnchor="end" fontSize="11" fill="#7d8b99">
                      ruled out
                    </text>
                  ) : (
                    <>
                      <rect x={bx + 74} y={cy - 3} width={64} height={6} rx={3} fill="#1a2430" />
                      <rect x={bx + 74} y={cy - 3} width={Math.max(1.5, 64 * b.fair)} height={6} rx={3} fill={b.lead ? "#ff7a3d" : "#ff7a3d99"} />
                      <text x={width - 12} y={cy + 4} textAnchor="end" fontSize="12" fill={b.lead ? "#ff7a3d" : "#9aa7b4"} fontWeight={b.lead ? 600 : 400} className="num">
                        {pct(b.fair)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
        </svg>
      </div>

      {/* Narrow layout: probabilities as a list under the chart */}
      {!wide && (
        <div className="mt-3 columns-2 gap-x-6 text-sm">
          {[...bands].reverse().map((b) => (
            <div key={b.symbol} className={`flex break-inside-avoid items-center justify-between py-0.5 ${b.dead ? "text-muted/60 line-through" : ""}`}>
              <span className="num">{shortLabel(b.label)}</span>
              <span className={`num ${b.lead ? "font-semibold text-accent" : "text-muted"}`}>{b.dead ? "out" : pct(b.fair)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
