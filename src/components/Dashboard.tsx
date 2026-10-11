"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Board, CityCard } from "@/lib/board";
import Backtest from "./Backtest";
import CityDetail from "./CityDetail";
import SandboxDesk from "./SandboxDesk";
import UsMap from "./UsMap";

type Payload = Board & { dates: string[]; error?: string };

const pct = (p: number) => `${Math.round(p * 100)}%`;

export default function Dashboard() {
  const [data, setData] = useState<Payload | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<"edge" | "certainty" | "city">("certainty");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/board${date ? `?date=${date}` : ""}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as Payload;
      setData(j);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const cities = useMemo(() => {
    const list = [...(data?.cities ?? [])];
    const top = (c: CityCard) => Math.max(...c.quotes.map((q) => q.fair));
    if (sort === "certainty") list.sort((a, b) => top(b) - top(a));
    if (sort === "edge")
      list.sort(
        (a, b) =>
          b.quotes.filter((q) => q.edge).length -
            a.quotes.filter((q) => q.edge).length ||
          b.dayProgress - a.dayProgress,
      );
    if (sort === "city") list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [data, sort]);

  const current = data?.cities.find((c) => c.ticker === selected) ?? null;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-3">
            <Logo />
            <h1 className="text-2xl font-semibold tracking-tight">Highwater</h1>
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Where will today&apos;s high land? Live nowcasts and two-sided
            quotes for every Gemini daily high temperature contract, conditioned
            on what the thermometer has already recorded.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.dates?.map((d) => (
            <button
              key={d}
              onClick={() => {
                setDate(d);
                setSelected(null);
              }}
              className={`rounded-md border px-3 py-1.5 text-sm num ${
                (date ?? data.cities[0]?.date) === d
                  ? "border-accent text-accent"
                  : "border-line text-muted hover:text-foreground"
              }`}
            >
              {d}
            </button>
          ))}
          <button
            onClick={load}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {data?.error && (
        <p className="mt-6 rounded-md border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          {data.error}
        </p>
      )}

      {data && !data.error && (
        <>
          <Stats data={data} />
          <UsMap cities={data.cities} onSelect={setSelected} />
          <div className="mt-10 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              {cities.length} cities
            </h2>
            <div className="flex gap-1 text-xs">
              {(["certainty", "edge", "city"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={`rounded px-2 py-1 ${sort === s ? "bg-panel-2 text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  {s === "certainty"
                    ? "Most certain"
                    : s === "edge"
                      ? "Market edges"
                      : "A–Z"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cities.map((c) => (
              <Card
                key={c.ticker}
                c={c}
                onClick={() => setSelected(c.ticker)}
              />
            ))}
          </div>
          <Backtest />
          <SandboxDesk />
          <HowItWorks params={data.params} />
        </>
      )}

      {!data && (
        <p className="mt-10 text-muted">
          Pulling markets, METARs and 82 ensemble members for 49 cities…
        </p>
      )}

      {current && (
        <CityDetail
          c={current}
          now={data!.generatedAt}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function Stats({ data }: { data: Payload }) {
  const s = data.stats;
  const items = [
    { k: "Contracts listed", v: s.contracts },
    { k: "Quoted by the market", v: s.quotedByMarket, tone: "text-bad" },
    { k: "Quoted by Highwater", v: s.quotedByUs, tone: "text-good" },
    { k: "Already impossible", v: s.dead, tone: "text-muted" },
    { k: "Market edges ≥ 5¢", v: s.edges, tone: "text-accent" },
  ];
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map((i) => (
        <div key={i.k} className="rounded-lg border border-line bg-panel p-3">
          <div className={`num text-2xl font-semibold ${i.tone ?? ""}`}>
            {i.v}
          </div>
          <div className="text-xs text-muted">{i.k}</div>
        </div>
      ))}
      <p className="col-span-2 text-xs text-muted sm:col-span-5">
        Updated {new Date(data.generatedAt).toLocaleTimeString()} · refreshes
        every minute · market data from Gemini&apos;s public API, observations
        from aviationweather.gov, ensembles from Open-Meteo (GFS + ECMWF, 82
        members)
      </p>
    </div>
  );
}

function Card({ c, onClick }: { c: CityCard; onClick: () => void }) {
  const lead = [...c.quotes].sort((a, b) => b.fair - a.fair)[0];
  const edges = c.quotes.filter((q) => q.edge).length;
  return (
    <button
      onClick={onClick}
      className="flex h-full flex-col rounded-xl border border-line bg-panel p-4 text-left transition hover:border-accent/50 hover:bg-panel-2"
    >
      <div className="flex w-full items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium leading-tight">{c.name}</div>
          <div className="num mt-0.5 text-xs text-muted">
            {c.station} · {c.localTime}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="num text-[26px] font-semibold leading-none text-accent">
            {c.observedMax != null ? `${c.observedMax.toFixed(0)}°` : "—"}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">
            high so far
          </div>
        </div>
      </div>

      <div className="mt-3 flex w-full items-center gap-2 text-[10px] text-muted">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cool to-accent"
            style={{ width: pct(c.dayProgress) }}
          />
        </div>
        <span className="num shrink-0">{pct(c.dayProgress)} of day</span>
      </div>

      <div className="mt-3 w-full space-y-1.5">
        {c.quotes.map((q) => {
          const dead = q.status === "dead";
          return (
            <div
              key={q.symbol}
              className={`grid grid-cols-[76px_1fr_34px] items-center gap-2 text-xs ${dead ? "opacity-35" : ""}`}
            >
              <span className="num truncate">{shortLabel(q.label)}</span>
              <div className="relative h-2 rounded-full bg-line/70">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${q === lead ? "bg-accent" : "bg-accent/55"}`}
                  style={{ width: pct(q.fair) }}
                />
                {q.forecastOnly >= 0.01 && (
                  <div
                    className="absolute -inset-y-0.5 w-[3px] rounded-full bg-cool"
                    style={{ left: `calc(${pct(q.forecastOnly)} - 1.5px)` }}
                  />
                )}
                {q.market.last != null && (
                  <div
                    className="absolute -inset-y-1 w-[2px] bg-foreground"
                    style={{ left: `calc(${pct(q.market.last)} - 1px)` }}
                  />
                )}
              </div>
              <span
                className={`num text-right ${q === lead ? "font-semibold text-foreground" : "text-muted"}`}
              >
                {pct(q.fair)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-auto w-full pt-3" />
      <div className="flex w-full items-center justify-between border-t border-line/60 pt-3 text-[11px] text-muted">
        <span>
          median <span className="num text-foreground">{c.median}°</span> · 80%{" "}
          <span className="num">
            {c.p10}–{c.p90}°
          </span>
        </span>
        {edges > 0 ? (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">
            {edges} edge
          </span>
        ) : (
          <span className="num">
            bias {c.bias >= 0 ? "+" : ""}
            {c.bias}°
          </span>
        )}
      </div>
    </button>
  );
}

export function shortLabel(l: string) {
  return l
    .replace("°F or below", "° or less")
    .replace("°F or above", "°+")
    .replace(/°F to (\d+)°F/, "–$1°")
    .replace(/°F/g, "°");
}

function HowItWorks({ params }: { params: Board["params"] }) {
  return (
    <section className="mt-14">
      <h2 className="text-lg font-semibold tracking-tight">How it works</h2>
      <div className="mt-4 grid gap-3 text-sm leading-relaxed text-muted md:grid-cols-3">
        <div className="rounded-xl border border-line bg-panel p-5">
          <h3 className="mb-1 font-medium text-foreground">1 · The floor</h3>
          Gemini settles on the NWS Daily Climate Report, a midnight-to-midnight
          local <em>standard</em> time window. Every METAR since that midnight
          (plus the 6-hour max groups) gives the high so far. The official high
          can&apos;t finish below it, so any bin under it is dead.
        </div>
        <div className="rounded-xl border border-line bg-panel p-5">
          <h3 className="mb-1 font-medium text-foreground">
            2 · The rest of the day
          </h3>
          82 ensemble members (GFS + ECMWF) cover the remaining hours, shifted
          by today&apos;s observed forecast miss (recency weighted,{" "}
          {params.biasHalfLifeHours}h half-life) with error that grows with lead
          time ({params.noiseBase}°F + {params.noiseSlope}°F/h, capped at{" "}
          {params.noiseCap}°F).
        </div>
        <div className="rounded-xl border border-line bg-panel p-5">
          <h3 className="mb-1 font-medium text-foreground">3 · Price it</h3>
          Final high = max(high so far + unobserved peak, hottest remaining
          hour), Monte Carlo over all members, rounded to whole °F. Bars:{" "}
          <span className="text-accent">Highwater</span>; blue tick:{" "}
          <span className="text-cool">forecast alone</span>; white tick = last
          market trade. Params: {params.source}.
        </div>
      </div>
    </section>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="7" fill="#141b24" />
      <path
        d="M4 19 Q9 13 14 17 T24 12"
        stroke="#4cc2ff"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M4 9 H24"
        stroke="#ff7a3d"
        strokeWidth="2"
        strokeDasharray="2 2.5"
      />
    </svg>
  );
}
