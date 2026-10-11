"use client";

import { geoAlbersUsa, geoPath } from "d3-geo";
import { useMemo, useState } from "react";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import states from "us-atlas/states-10m.json";
import type { CityCard } from "@/lib/board";

const W = 960;
const H = 560;

// 50°F cool blue -> 95°F hot orange-red
function tempColor(f: number | null) {
  if (f == null) return "#7d8b99";
  const t = Math.min(1, Math.max(0, (f - 50) / 45));
  const a = [76, 194, 255];
  const b = [255, 93, 61];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export default function UsMap({ cities, onSelect }: { cities: CityCard[]; onSelect: (ticker: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const { borders, nation, projection } = useMemo(() => {
    const topo = states as unknown as Topology<{ states: GeometryCollection }>;
    const land = feature(topo, topo.objects.states);
    const projection = geoAlbersUsa().fitExtent(
      [
        [10, 10],
        [W - 10, H - 10],
      ],
      land,
    );
    const path = geoPath(projection);
    return {
      projection,
      nation: path(land) ?? "",
      borders: path(mesh(topo, topo.objects.states, (a, b) => a !== b)) ?? "",
    };
  }, []);

  const dots = cities
    .map((c) => {
      const p = projection([c.lon, c.lat]);
      const certainty = Math.max(...c.quotes.map((q) => q.fair));
      return p ? { c, x: p[0], y: p[1], certainty, edges: c.quotes.filter((q) => q.edge).length } : null;
    })
    .filter((d): d is NonNullable<typeof d> => d != null)
    .sort((a, b) => a.certainty - b.certainty);
  // Label the most confident cities first; skip labels that would overlap.
  const labels: { key: string; x: number; y: number; text: string }[] = [];
  for (const d of [...dots].reverse()) {
    const x = d.x;
    const y = d.y - (5 + d.certainty * 11) - 4;
    if (labels.some((l) => Math.abs(l.x - x) < 34 && Math.abs(l.y - y) < 16)) continue;
    labels.push({ key: d.c.ticker, x, y, text: d.c.observedMax != null ? `${Math.round(d.c.observedMax)}°` : "—" });
  }
  const hovered = dots.find((d) => d.c.ticker === hover);

  return (
    <div className="relative mt-5 rounded-xl border border-line bg-panel p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto max-h-[460px] w-full">
        <path d={nation} fill="#111821" />
        <path d={borders} fill="none" stroke="#1f2a36" strokeWidth="0.8" />
        {dots.map(({ c, x, y, certainty, edges }) => {
          const r = 5 + certainty * 11;
          return (
            <g
              key={c.ticker}
              transform={`translate(${x},${y})`}
              className="cursor-pointer"
              onMouseEnter={() => setHover(c.ticker)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(c.ticker)}
            >
              <circle r={r + 6} fill={tempColor(c.observedMax)} opacity={0.12} />
              <circle r={r} fill={tempColor(c.observedMax)} opacity={0.85} stroke={edges ? "#ff7a3d" : "#07090d"} strokeWidth={edges ? 2.5 : 1} />
            </g>
          );
        })}
        {labels.map((l) => (
          <text key={l.key} x={l.x} y={l.y} textAnchor="middle" fontSize="11" fill="#e6edf3" className="num" style={{ pointerEvents: "none" }}>
            {l.text}
          </text>
        ))}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute rounded-lg border border-line bg-background/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: `${(hovered.x / W) * 100}%`, top: `${(hovered.y / H) * 100}%`, transform: "translate(-50%, calc(-100% - 28px))" }}
        >
          <div className="font-medium text-foreground">{hovered.c.name}</div>
          <div className="num text-muted">
            high so far {hovered.c.observedMax ?? "—"}° · median {hovered.c.median}° · {Math.round(hovered.certainty * 100)}% on top bin
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 pb-2 text-[11px] text-muted">
        <span className="flex items-center gap-2">
          color = high so far
          <span className="h-2 w-24 rounded" style={{ background: `linear-gradient(90deg, ${tempColor(50)}, ${tempColor(72)}, ${tempColor(95)})` }} />
          <span className="num">50°→95°</span>
        </span>
        <span>size = confidence in the leading bin</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-accent" /> market edge ≥ 5¢
        </span>
        <span>click a city for detail</span>
      </div>
    </div>
  );
}
