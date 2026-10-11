"use client";

import { useMemo, useRef, useState } from "react";
import type { CityCard } from "@/lib/board";
import { useBoard, type BoardPayload } from "@/lib/useBoard";
import CityPanel from "./CityPanel";
import UsMap from "./UsMap";

type Filter = "all" | "settling" | "open" | "edges";

const top = (c: CityCard) => Math.max(...c.quotes.map((q) => q.fair));

const FILTERS: { id: Filter; label: string; test: (c: CityCard) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "settling", label: "Nearly decided", test: (c) => top(c) >= 0.9 },
  { id: "open", label: "Still open", test: (c) => top(c) < 0.6 },
  { id: "edges", label: "Market edges", test: (c) => c.quotes.some((q) => q.edge) },
];

const match = (c: CityCard, q: string) =>
  !q || c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.station.toLowerCase().includes(q);

export default function Board() {
  const [date, setDate] = useState<string | null>(null);
  const { data, loading, refresh } = useBoard(date);
  // A city opens only when clicked.
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const panelRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => data?.cities ?? [], [data]);
  const q = query.trim().toLowerCase();
  const test = FILTERS.find((f) => f.id === filter)!.test;
  const visible = all.filter((c) => test(c) && match(c, q));
  const dimmed = new Set(all.filter((c) => !visible.includes(c)).map((c) => c.ticker));
  const suggestions = q ? visible.slice(0, 6) : [];

  // Nothing is selected until a city is clicked.
  const current = selected ? (all.find((c) => c.ticker === selected || c.city.toUpperCase() === selected.toUpperCase()) ?? null) : null;

  function close() {
    setSelected(null);
  }

  function select(id: string) {
    setSelected(id);
    setQuery("");
    // On narrow screens the panel sits below the map; bring it into view.
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-6 pb-4">
        <h1 className="text-xl font-semibold tracking-tight">
          Today&apos;s high <span className="text-muted">· 49 cities</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {data?.dates?.map((d) => (
            <button
              key={d}
              onClick={() => setDate(d)}
              className={`num rounded-md border px-2.5 py-1 text-xs ${
                (date ?? data.cities?.[0]?.date) === d ? "border-accent text-accent" : "border-line text-muted hover:text-foreground"
              }`}
            >
              {d}
            </button>
          ))}
          <button onClick={refresh} className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-foreground">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {data?.error && <p className="rounded-md border border-bad/40 bg-bad/10 p-3 text-sm text-bad">Couldn&apos;t load the board: {data.error}</p>}
      {!data && <BoardSkeleton />}

      {data && !data.error && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && suggestions[0]) select(suggestions[0].ticker);
                }}
                placeholder="Find a city or station"
                aria-label="Find a city or station"
                className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm placeholder:text-muted focus:border-accent/60 focus:outline-none"
              />
              {suggestions.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-line bg-panel-2 shadow-xl">
                  {suggestions.map((c) => (
                    <li key={c.ticker}>
                      <button onClick={() => select(c.ticker)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-panel">
                        <span>
                          {c.name} <span className="num text-xs text-muted">{c.station}</span>
                        </span>
                        <span className="num text-accent">{c.observedMax != null ? `${Math.round(c.observedMax)}°` : "—"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map((f) => {
                const n = all.filter(f.test).length;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      filter === f.id ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-muted hover:text-foreground"
                    }`}
                  >
                    {f.label} <span className="num opacity-70">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3">
            <UsMap cities={all} onSelect={select} selected={current?.ticker ?? null} dimmed={dimmed} />
          </div>

          {current && (
            <div
              className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-md"
              onClick={close}
              onKeyDown={(e) => e.key === "Escape" && close()}
              role="dialog"
              aria-modal="true"
              aria-label={`${current.name} details`}
            >
              <aside
                ref={panelRef}
                className="drawer-in relative h-full w-full max-w-[540px] overflow-y-auto border-l border-line bg-background p-3 sm:p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={close}
                  autoFocus
                  aria-label="Close city panel"
                  className="absolute top-6 right-6 z-10 rounded-md border border-line bg-background/80 px-2 py-0.5 text-sm text-muted hover:text-foreground"
                >
                  ✕
                </button>
                <CityPanel c={current} now={data.generatedAt} />
              </aside>
            </div>
          )}

          <div className="mt-6">
            <Stats data={data} />
          </div>

          <p className="mt-6 text-center text-xs text-muted">
            Updated {new Date(data.generatedAt).toLocaleTimeString()} · refreshes every minute · markets from Gemini&apos;s public
            API, observations from aviationweather.gov, ensembles from Open-Meteo (GFS + ECMWF, 82 members).
          </p>
        </>
      )}
    </div>
  );
}

function Stats({ data }: { data: BoardPayload }) {
  const s = data.stats;
  const items = [
    { k: "Contracts today", v: s.contracts },
    { k: "Have a market quote", v: s.quotedByMarket, tone: "text-bad" },
    { k: "Priced by Highwater", v: s.quotedByUs, tone: "text-good" },
    { k: "Already ruled out", v: s.dead },
    { k: "Market edges ≥ 5¢", v: s.edges, tone: "text-accent" },
  ];
  return (
    <dl className="grid grid-cols-2 divide-line border-y border-line text-center sm:grid-cols-5 sm:divide-x">
      {items.map((i, n) => (
        <div key={i.k} className={`py-4 ${n === items.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}>
          <dd className={`num text-2xl font-semibold ${i.tone ?? ""}`}>{i.v}</dd>
          <dt className="mt-0.5 text-xs text-muted">{i.k}</dt>
        </div>
      ))}
    </dl>
  );
}

function BoardSkeleton() {
  return (
    <div>
      <p className="text-center text-sm text-muted">Pulling markets, weather reports and 82 forecast runs for 49 cities…</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="h-[420px] animate-pulse rounded-2xl border border-line bg-panel" />
        <div className="h-[420px] animate-pulse rounded-2xl border border-line bg-panel" />
      </div>
    </div>
  );
}
