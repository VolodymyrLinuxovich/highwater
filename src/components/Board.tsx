"use client";

import { useMemo, useState } from "react";
import type { CityCard } from "@/lib/board";
import { pct, shortLabel } from "@/lib/format";
import { useBoard, type BoardPayload } from "@/lib/useBoard";
import CityDetail from "./CityDetail";
import UsMap from "./UsMap";

type Filter = "all" | "settling" | "open" | "edges";
type Sort = "certainty" | "progress" | "city";

const top = (c: CityCard) => Math.max(...c.quotes.map((q) => q.fair));

const FILTERS: { id: Filter; label: string; test: (c: CityCard) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "settling", label: "Nearly decided (≥ 90%)", test: (c) => top(c) >= 0.9 },
  { id: "open", label: "Still open (< 60%)", test: (c) => top(c) < 0.6 },
  { id: "edges", label: "Market edges", test: (c) => c.quotes.some((q) => q.edge) },
];

export default function Board() {
  const [date, setDate] = useState<string | null>(null);
  const { data, loading, refresh } = useBoard(date);
  // Deep link: /board?city=NYC opens that city's detail once data arrives.
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("city"),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("certainty");

  const cities = useMemo(() => {
    const q = query.trim().toLowerCase();
    const test = FILTERS.find((f) => f.id === filter)!.test;
    const list = (data?.cities ?? []).filter(
      (c) => test(c) && (!q || c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.station.toLowerCase().includes(q)),
    );
    if (sort === "certainty") list.sort((a, b) => top(b) - top(a));
    if (sort === "progress") list.sort((a, b) => b.dayProgress - a.dayProgress);
    if (sort === "city") list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [data, query, filter, sort]);

  const current =
    data?.cities?.find((c) => c.ticker === selected || c.city.toUpperCase() === selected?.toUpperCase()) ?? null;

  function select(id: string | null) {
    setSelected(id);
    const url = new URL(window.location.href);
    const city = data?.cities?.find((c) => c.ticker === id)?.city;
    if (city) url.searchParams.set("city", city);
    else url.searchParams.delete("city");
    window.history.replaceState(null, "", url);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 pt-10 pb-6 sm:pt-12">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-accent">Live board</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Today&apos;s high, 49 cities</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Each card shows the highest temperature recorded so far and the contract Highwater rates most likely. Select a city
            for every contract&apos;s probability, our quotes and the market&apos;s book.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.dates?.map((d) => (
            <button
              key={d}
              onClick={() => {
                setDate(d);
                select(null);
              }}
              className={`num rounded-md border px-3 py-1.5 text-sm ${
                (date ?? data.cities?.[0]?.date) === d ? "border-accent text-accent" : "border-line text-muted hover:text-foreground"
              }`}
            >
              {d}
            </button>
          ))}
          <button onClick={refresh} className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-foreground">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {data?.error && <p className="rounded-md border border-bad/40 bg-bad/10 p-3 text-sm text-bad">Couldn&apos;t load the board: {data.error}</p>}
      {!data && <BoardSkeleton />}

      {data && !data.error && (
        <>
          <Stats data={data} />
          <UsMap cities={data.cities} onSelect={select} />

          <div className="sticky top-14 z-30 -mx-4 mt-8 border-b border-line bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search city or station (e.g. Denver, KMDW)"
                className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm placeholder:text-muted focus:border-accent/60 focus:outline-none lg:max-w-xs"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {FILTERS.map((f) => {
                  const n = (data.cities ?? []).filter(f.test).length;
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
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="ml-1 rounded-md border border-line bg-panel px-2 py-1 text-xs text-muted"
                  aria-label="Sort"
                >
                  <option value="certainty">Sort: most certain</option>
                  <option value="progress">Sort: furthest through the day</option>
                  <option value="city">Sort: A–Z</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cities.map((c) => (
              <Card key={c.ticker} c={c} onClick={() => select(c.ticker)} />
            ))}
          </div>
          {cities.length === 0 && <p className="mt-8 text-center text-sm text-muted">No cities match.</p>}
          <p className="mt-6 text-xs text-muted">
            Updated {new Date(data.generatedAt).toLocaleTimeString()} · refreshes every minute · markets from Gemini&apos;s public
            API, observations from aviationweather.gov, ensembles from Open-Meteo (GFS + ECMWF, 82 members).
          </p>
        </>
      )}

      {current && data && <CityDetail c={current} now={data.generatedAt} onClose={() => select(null)} />}
    </div>
  );
}

function Stats({ data }: { data: BoardPayload }) {
  const s = data.stats;
  const items = [
    { k: "Contracts listed today", v: s.contracts },
    { k: "Have a market quote", v: s.quotedByMarket, tone: "text-bad" },
    { k: "Priced by Highwater", v: s.quotedByUs, tone: "text-good" },
    { k: "Already impossible", v: s.dead },
    { k: "Market edges ≥ 5¢", v: s.edges, tone: "text-accent" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map((i, n) => (
        <div key={i.k} className={`rounded-xl border border-line bg-panel p-3.5 ${n === items.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}>
          <div className={`num text-2xl font-semibold ${i.tone ?? ""}`}>{i.v}</div>
          <div className="mt-0.5 text-xs text-muted">{i.k}</div>
        </div>
      ))}
    </div>
  );
}

function Card({ c, onClick }: { c: CityCard; onClick: () => void }) {
  const lead = [...c.quotes].sort((a, b) => b.fair - a.fair)[0];
  const edges = c.quotes.filter((q) => q.edge).length;
  const dead = c.quotes.filter((q) => q.status === "dead").length;
  return (
    <button
      onClick={onClick}
      className="flex h-full flex-col rounded-xl border border-line bg-panel p-4 text-left transition hover:border-accent/50 hover:bg-panel-2"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium leading-tight">{c.name}</div>
          <div className="num mt-0.5 text-xs text-muted">
            {c.station} · {c.localTime}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="num text-2xl font-semibold leading-none text-accent">
            {c.observedMax != null ? `${c.observedMax.toFixed(0)}°` : "—"}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">high so far</div>
        </div>
      </div>

      <div className="mt-4 w-full">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted">Most likely</span>
          <span>
            <span className="num font-medium">{shortLabel(lead.label)}</span>{" "}
            <span className="num font-semibold text-accent">{pct(lead.fair)}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full rounded-full bg-line/70">
          <div className="h-full rounded-full bg-accent" style={{ width: pct(lead.fair) }} />
        </div>
      </div>

      <div className="mt-auto w-full pt-4" />
      <div className="flex w-full items-center justify-between border-t border-line/60 pt-3 text-[11px] text-muted">
        <span className="num">
          {pct(c.dayProgress)} of day · {dead} ruled out
        </span>
        {edges > 0 ? <span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">{edges} edge</span> : <span>Details →</span>}
      </div>
    </button>
  );
}

function BoardSkeleton() {
  return (
    <div>
      <p className="text-sm text-muted">Pulling markets, METARs and 82 ensemble members for 49 cities…</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-xl border border-line bg-panel" />
        ))}
      </div>
      <div className="mt-5 h-[420px] animate-pulse rounded-xl border border-line bg-panel" />
    </div>
  );
}
