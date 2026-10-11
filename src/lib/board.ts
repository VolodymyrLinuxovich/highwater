import { mapLimit } from "./cache";
import { nowcast, quote, quantile, type Quote } from "./engine";
import { ensembles } from "./forecast";
import { weatherEvents } from "./markets";
import { observedMax, recentMetars } from "./obs";
import { PARAMS } from "./params";
import { climateDay, stationFor, stationMeta } from "./stations";

export type CityCard = {
  ticker: string;
  city: string;
  name: string;
  station: string;
  lat: number;
  lon: number;
  timeZone: string;
  date: string;
  localTime: string;
  dayProgress: number; // 0..1 through the climate day
  observedMax: number | null;
  observedAt: number | null;
  lastObs: { t: number; f: number; raw: string } | null;
  bias: number;
  weight: number;
  hoursLeft: number;
  median: number;
  p10: number;
  p90: number;
  dist: { f: number; p: number; fc: number }[];
  quotes: Quote[];
  obs: { t: number; f: number }[];
  fan: { t: number; p10: number; p50: number; p90: number }[];
  window: { start: number; end: number };
  error?: string;
};

export type Board = {
  generatedAt: number;
  params: typeof PARAMS;
  stats: { events: number; contracts: number; quotedByMarket: number; quotedByUs: number; dead: number; locked: number; edges: number };
  cities: CityCard[];
};

const pad = (n: number) => String(n).padStart(2, "0");

export async function buildBoard(opts: { date?: string } = {}): Promise<Board> {
  const now = Date.now();
  let events = await weatherEvents();
  const dates = [...new Set(events.map((e) => `${e.date.y}-${pad(e.date.m)}-${pad(e.date.d)}`))].sort();
  const date = opts.date ?? dates[0];
  events = events.filter((e) => `${e.date.y}-${pad(e.date.m)}-${pad(e.date.d)}` === date);

  const stations = events.map((e) => stationFor(e.city));
  const metas = await mapLimit(stations, 8, (s) => stationMeta(s).catch(() => null));
  const ok = metas.map((m, i) => ({ m, e: events[i] })).filter((x) => x.m != null);
  const [metars, ens] = await Promise.all([
    recentMetars(ok.map((x) => x.m!.id)),
    ensembles(ok.map((x) => ({ lat: x.m!.lat, lon: x.m!.lon }))),
  ]);

  const cities: CityCard[] = ok.map(({ m, e }, i) => {
    const meta = m!;
    const { start, end } = climateDay(meta.timeZone, e.date.y, e.date.m, e.date.d);
    const { obs, sixMax } = metars.get(meta.id) ?? { obs: [], sixMax: [] };
    const om = observedMax(obs, sixMax, start, end, now);
    const n = nowcast({ seed: `${e.ticker}:${Math.floor(now / 600_000)}`, ens: ens[i], obs, observedMax: om?.f ?? null, start, end, now });
    const quotes = e.contracts.map((c) => quote(c, n));
    const keys = [...new Set([...n.nowcast.keys(), ...n.forecastOnly.keys()])].sort((a, b) => a - b);
    const lastObs = obs.filter((o) => o.t <= now).at(-1) ?? null;
    return {
      ticker: e.ticker,
      city: e.city,
      name: e.title.replace(/^Highest temperature in /, "").replace(/ on .*$/, ""),
      station: meta.id,
      lat: meta.lat,
      lon: meta.lon,
      timeZone: meta.timeZone,
      date,
      localTime: new Intl.DateTimeFormat("en-US", { timeZone: meta.timeZone, hour: "numeric", minute: "2-digit" }).format(now),
      dayProgress: Math.min(1, Math.max(0, (now - start) / (end - start))),
      observedMax: om ? Math.round(om.f * 10) / 10 : null,
      observedAt: om?.at ?? null,
      lastObs,
      bias: Math.round(n.bias * 10) / 10,
      weight: n.weight,
      hoursLeft: Math.round(n.hoursLeft * 10) / 10,
      median: n.median,
      p10: quantile(n.nowcast, 0.1),
      p90: quantile(n.nowcast, 0.9),
      dist: keys.map((f) => ({ f, p: n.nowcast.get(f) ?? 0, fc: n.forecastOnly.get(f) ?? 0 })),
      quotes,
      obs: obs.filter((o) => o.t >= start - 6 * 3_600_000).map((o) => ({ t: o.t, f: Math.round(o.f * 10) / 10 })),
      fan: n.fan,
      window: { start, end },
    };
  });

  const all = cities.flatMap((c) => c.quotes);
  return {
    generatedAt: now,
    params: PARAMS,
    stats: {
      events: cities.length,
      contracts: all.length,
      quotedByMarket: all.filter((q) => q.market.bid != null || q.market.ask != null).length,
      quotedByUs: all.filter((q) => q.bid != null || q.ask != null).length,
      dead: all.filter((q) => q.status === "dead").length,
      locked: all.filter((q) => q.status === "locked").length,
      edges: all.filter((q) => q.edge).length,
    },
    cities,
  };
}

export async function boardDates() {
  const events = await weatherEvents();
  return [...new Set(events.map((e) => `${e.date.y}-${pad(e.date.m)}-${pad(e.date.d)}`))].sort();
}
