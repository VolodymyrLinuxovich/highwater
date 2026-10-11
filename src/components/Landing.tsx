"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CityCard } from "@/lib/board";
import { pct, shortLabel, tempColor } from "@/lib/format";
import { useBoard } from "@/lib/useBoard";
import HighwaterChart from "./HighwaterChart";
import { CountUp, Reveal, useInView } from "./Reveal";

const FEATURED = [
  "NYC",
  "CHI",
  "MIA",
  "DEN",
  "LA",
  "SEA",
  "ATL",
  "DFW",
  "PHX",
  "BOS",
];

// The hero instrument: one real city's day, switchable between a few live cities.
export function Instrument() {
  const { data } = useBoard();
  const [pick, setPick] = useState<string | null>(null);
  const cities = (data?.cities ?? []).filter((c) => FEATURED.includes(c.city));
  const options = FEATURED.map((code) => cities.find((c) => c.city === code))
    .filter((c): c is CityCard => !!c)
    .slice(0, 5);
  const fallback =
    options.find((c) => c.quotes.some((q) => q.status === "dead")) ??
    options[0];
  const c = options.find((o) => o.city === pick) ?? fallback;

  if (data?.error) {
    return (
      <p className="py-16 text-center text-sm text-muted">
        Live data is unavailable right now.{" "}
        <Link className="text-accent underline" href="/board">
          Try the live board
        </Link>
        .
      </p>
    );
  }
  if (!c || !data) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-muted">
        Reading weather reports and 82 forecast runs…
      </div>
    );
  }

  const dead = c.quotes.filter((q) => q.status === "dead").length;
  const lead = [...c.quotes].sort((a, b) => b.fair - a.fair)[0];
  const at = c.observedAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: c.timeZone,
        hour: "numeric",
        minute: "2-digit",
      }).format(c.observedAt)
    : null;

  return (
    <div>
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-wrap justify-center gap-1" role="tablist" aria-label="City">
          {options.map((o) => (
            <button
              key={o.city}
              role="tab"
              aria-selected={o === c}
              onClick={() => setPick(o.city)}
              className={`rounded-full px-3 py-1 text-sm transition ${
                o === c
                  ? "bg-foreground text-background"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {o.name}{" "}
              <span className="num opacity-60">
                {o.observedMax != null ? `${Math.round(o.observedMax)}°` : ""}
              </span>
            </button>
          ))}
        </div>
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="hw-pulse inline-block h-1.5 w-1.5 rounded-full bg-good" />
          Live · {c.station} · Gemini {c.ticker}
        </span>
      </div>

      <div className="mt-4">
        <HighwaterChart c={c} now={data.generatedAt} />
      </div>

      <p className="mx-auto mt-4 max-w-3xl text-center text-[15px] leading-relaxed text-muted">
        {c.observedMax != null ? (
          <>
            In {c.name} the high reached{" "}
            <span className="num text-foreground">{c.observedMax}°F</span>
            {at ? ` at ${at}` : ""}.{" "}
            {dead > 0 ? (
              <>
                <span className="text-foreground">
                  {dead} of {c.quotes.length} ranges
                </span>{" "}
                can no longer win.{" "}
              </>
            ) : (
              "No range is ruled out yet. "
            )}
          </>
        ) : null}
        Highwater gives{" "}
        <span className="num text-foreground">{shortLabel(lead.label)}</span> a{" "}
        <span className="num text-accent">{pct(lead.fair)}</span> chance, with{" "}
        {c.hoursLeft}h of the climate day left.{" "}
        <Link
          href={`/board?city=${c.city}`}
          className="whitespace-nowrap text-accent hover:underline"
        >
          Every contract →
        </Link>
      </p>
    </div>
  );
}

type Real = {
  events: number;
  cities: number;
  period: { start: string; end: string };
  stationCheck: { agree: number }[];
  byAsOfHour: {
    hour: number;
    nowcast: { brier: number };
    forecastOnly: { brier: number };
  }[];
  dead: {
    ruledOut: number;
    resolvedNo: number;
    withTruncatedFloor?: { ruledOut: number; resolvedNo: number };
  };
};

// Proof, computed from public/realcontracts.json.
export function Proof() {
  const [r, setR] = useState<Real | null>(null);
  useEffect(() => {
    fetch("/realcontracts.json")
      .then((x) => (x.ok ? x.json() : null))
      .then(setR)
      .catch(() => setR(null));
  }, []);
  if (!r) return <div className="h-[140px]" />;
  const at18 = r.byAsOfHour.find((h) => h.hour === 18) ?? r.byAsOfHour.at(-1)!;
  const dead = r.dead.withTruncatedFloor ?? r.dead;
  const agree = r.stationCheck.filter((s) => s.agree === 1).length;
  const items = [
    {
      big: `${Math.round((1 - at18.nowcast.brier / at18.forecastOnly.brier) * 100)}%`,
      label: `lower Brier score than the forecast alone at 6pm (${at18.nowcast.brier.toFixed(3)} vs ${at18.forecastOnly.brier.toFixed(3)})`,
      tone: "text-good",
    },
    {
      big: `${dead.resolvedNo.toLocaleString("en-US")}/${dead.ruledOut.toLocaleString("en-US")}`,
      label: "contracts called impossible that settled NO",
      tone: "text-accent",
    },
    {
      big: `${agree}/${r.stationCheck.length}`,
      label: "cities where our station matched every Gemini settlement",
      tone: "text-cool",
    },
  ];
  return (
    <div>
      <div className="grid divide-line text-center sm:grid-cols-3 sm:divide-x">
        {items.map((i, n) => (
          <Reveal
            key={i.label}
            delay={n * 120}
            className={`py-5 sm:py-1 ${n > 0 ? "border-t border-line sm:border-t-0" : ""} sm:px-6`}
          >
            <div
              className={`num text-5xl font-semibold tracking-tight ${i.tone}`}
            >
              <CountUp value={i.big} />
            </div>
            <div className="mt-2 text-sm leading-snug text-muted">
              {i.label}
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={360}>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-muted">
          Replayed on {r.events} settled Gemini markets ({r.cities} cities,{" "}
          {r.period.start} to {r.period.end}), using only the reports available
          at each hour. Caveats: the historical forecasts behave like
          short-range runs, which flatters the baseline; some parameters were
          fitted on the same days; before noon Highwater is no better than the
          forecast, so it leans on it.{" "}
          <Link
            href="/results"
            className="whitespace-nowrap text-accent hover:underline"
          >
            Full results →
          </Link>
        </p>
      </Reveal>
    </div>
  );
}

// Replaces a generic eyebrow with what is true right now.
export function LiveLine() {
  const { data } = useBoard();
  const s = data?.stats;
  const day = data?.cities?.[0]?.date;
  return (
    <div className="flex min-h-5 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted">
      <span className="flex items-center gap-2 text-good">
        <span className="hw-pulse inline-block h-1.5 w-1.5 rounded-full bg-good" />
        Live
      </span>
      {s && day && (
        <>
          <span className="num">
            {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
          </span>
          <span className="text-line">/</span>
          <span>
            <span className="num text-foreground">{s.dead}</span> of <span className="num">{s.contracts}</span> Gemini contracts
            already ruled out
          </span>
        </>
      )}
    </div>
  );
}

// Section transition: every city's high so far, west to east, growing in on scroll.
export function CityTape() {
  const { data } = useBoard();
  const { ref, seen } = useInView<HTMLDivElement>("0px 0px -10% 0px");
  const cities = [...(data?.cities ?? [])].filter((c) => c.observedMax != null).sort((a, b) => a.lon - b.lon);
  if (!cities.length) return <div ref={ref} className="h-[132px]" />;
  const highs = cities.map((c) => c.observedMax!);
  const lo = Math.min(...highs);
  const hi = Math.max(...highs);
  const coolest = cities[highs.indexOf(lo)];
  const hottest = cities[highs.indexOf(hi)];
  return (
    <div ref={ref} className={`tape ${seen ? "is-visible" : ""}`}>
      <div className="flex h-20 items-end gap-[3px]" role="img" aria-label={`Highs so far in ${cities.length} cities, from ${Math.round(lo)} to ${Math.round(hi)} degrees`}>
        {cities.map((c, i) => (
          <div
            key={c.ticker}
            title={`${c.name} ${Math.round(c.observedMax!)}°F`}
            className="tape-bar flex-1 rounded-t-sm"
            style={{
              height: `${18 + ((c.observedMax! - lo) / Math.max(1, hi - lo)) * 82}%`,
              background: tempColor(c.observedMax),
              transitionDelay: `${i * 18}ms`,
            }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs text-muted sm:justify-between">
        <span>
          {cities.length} cities, west to east · coolest <span className="text-cool">{coolest.name} {Math.round(lo)}°</span>
        </span>
        <span>
          hottest <span className="text-accent">{hottest.name} {Math.round(hi)}°</span> · high so far today
        </span>
      </div>
    </div>
  );
}
