"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CityCard } from "@/lib/board";
import { pct, shortLabel } from "@/lib/format";
import { useBoard } from "@/lib/useBoard";

// A real city from the live board, so visitors see the product immediately.
export function CityPreview() {
  const { data } = useBoard();
  const cities = data?.cities ?? [];
  const c: CityCard | undefined = cities.find((x) => x.city === "NYC") ?? [...cities].sort((a, b) => b.dayProgress - a.dayProgress)[0];

  if (data?.error) {
    return (
      <div className="rounded-2xl border border-line bg-panel p-6 text-sm text-muted">
        The live preview is unavailable right now. <Link className="text-accent underline" href="/board">Open the live board</Link>.
      </div>
    );
  }
  if (!c) return <div className="h-[340px] animate-pulse rounded-2xl border border-line bg-panel" />;

  const ranked = [...c.quotes].sort((a, b) => b.fair - a.fair);
  const shown = ranked.slice(0, 4).sort((a, b) => (a.bin.lo ?? -999) - (b.bin.lo ?? -999));
  const dead = c.quotes.filter((q) => q.status === "dead").length;

  return (
    <div className="rounded-2xl border border-line bg-panel p-5 shadow-2xl shadow-black/40 sm:p-6">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-good">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-good" />
          </span>
          Live
        </span>
        <span className="num text-muted">
          {c.station} · {c.localTime} local
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="text-sm text-muted">Highest temperature today in</div>
          <div className="text-2xl font-semibold tracking-tight">{c.name}</div>
        </div>
        <div className="text-right">
          <div className="num text-4xl font-semibold leading-none text-accent">
            {c.observedMax != null ? `${Math.round(c.observedMax)}°` : "—"}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">recorded so far</div>
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        {shown.map((q) => (
          <div key={q.symbol} className="grid grid-cols-[84px_1fr_40px] items-center gap-3 text-sm">
            <span className="num">{shortLabel(q.label)}</span>
            <div className="h-2 rounded-full bg-line/70">
              <div className={`h-full rounded-full ${q === ranked[0] ? "bg-accent" : "bg-accent/50"}`} style={{ width: pct(q.fair) }} />
            </div>
            <span className={`num text-right ${q === ranked[0] ? "font-semibold" : "text-muted"}`}>{pct(q.fair)}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-4 text-xs text-muted">
        <span>
          {pct(c.dayProgress)} of the climate day done · {dead} contract{dead === 1 ? "" : "s"} already impossible
        </span>
        <Link href={`/board?city=${c.city}`} className="text-accent hover:underline">
          See every contract →
        </Link>
      </div>
    </div>
  );
}

type Real = {
  events: number;
  cities: number;
  stationCheck: { agree: number }[];
  byAsOfHour: { hour: number; nowcast: { brier: number }; forecastOnly: { brier: number } }[];
  dead: { ruledOut: number; resolvedNo: number; withTruncatedFloor?: { ruledOut: number; resolvedNo: number } };
};

// Headline numbers, computed from public/realcontracts.json rather than typed in.
export function EvidenceStrip() {
  const [r, setR] = useState<Real | null>(null);
  useEffect(() => {
    fetch("/realcontracts.json")
      .then((x) => (x.ok ? x.json() : null))
      .then(setR)
      .catch(() => setR(null));
  }, []);
  if (!r) return <div className="h-[120px] animate-pulse rounded-2xl border border-line bg-panel" />;
  const at18 = r.byAsOfHour.find((h) => h.hour === 18) ?? r.byAsOfHour.at(-1)!;
  const dead = r.dead.withTruncatedFloor ?? r.dead;
  const agree = r.stationCheck.filter((s) => s.agree === 1).length;
  const items = [
    { big: `${Math.round((1 - at18.nowcast.brier / at18.forecastOnly.brier) * 100)}%`, label: "lower error than the forecast alone at 6pm", tone: "text-good" },
    { big: `${dead.resolvedNo.toLocaleString("en-US")} / ${dead.ruledOut.toLocaleString("en-US")}`, label: "contracts called impossible that settled NO", tone: "text-accent" },
    { big: `${agree} / ${r.stationCheck.length}`, label: "cities whose weather station matches every Gemini settlement", tone: "text-cool" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.label} className="rounded-2xl border border-line bg-panel p-5">
          <div className={`num text-3xl font-semibold ${i.tone}`}>{i.big}</div>
          <div className="mt-1 text-sm text-muted">{i.label}</div>
        </div>
      ))}
      <p className="text-xs text-muted sm:col-span-3">
        Replayed on {r.events} settled Gemini markets (one per city per day) in {r.cities} cities. Error is the Brier score.{" "}
        <Link href="/results" className="text-accent hover:underline">
          Method, full results and caveats →
        </Link>
      </p>
    </div>
  );
}
