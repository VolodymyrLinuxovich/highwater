/**
 * Highwater real-contract backtest: score the nowcast on REAL settled Gemini WXHIGH contracts
 * (real bins, real YES/NO resolutions) instead of synthetic bins.
 *
 * Run: npx tsx scripts/realcontracts.ts
 * Output: public/realcontracts.json + a summary on stdout.
 *
 * Steps
 *  1. Load settled WXHIGH events from the Gemini public API for START..END, all cities.
 *  2. Station-map validation: does the NWS CLI high of our mapped station (src/lib/stations.ts)
 *     fall in the contract Gemini resolved YES? Cities under 90% agreement get alternate stations
 *     tried; if one matches better it is used for the replay (and reported as a recommended override).
 *  3. Replay each event as of 12, 15, 18 LST using only METARs before that time (same models as
 *     scripts/backtest.ts) and score nowcast, floorOnly and forecastOnly on the event's real bins.
 *  4. Dead contracts: bins entirely below the observed floor; check they all resolved NO.
 *
 * Set HIGHWATER_CACHE_DIR=/some/dir to cache HTTP responses on disk while iterating.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stationFor } from "../src/lib/stations";
import {
  buildDay, fetchText, forecastOnly, hourlyObs, loadCli, loadStation, mean, nowcast, round3, score,
  type Day, type NoiseParams, type Score, type Station,
} from "./lib-replay";

const START = "2026-09-21";
const END = "2026-10-10";
const AS_OF_HOURS = [12, 15, 18];
const AGREE_THRESHOLD = 0.9;
const GEMINI = "https://api.gemini.com/v1/prediction-markets";

// Plausible alternate climate stations per Gemini city code (tried only if the mapped one disagrees).
const ALTERNATES: Record<string, string[]> = {
  NYC: ["KLGA", "KJFK", "KEWR"],
  CHI: ["KORD"],
  LA: ["KCQT", "KLGB", "KBUR"],
  AUS: ["KATT", "KAUS"],
  HOU: ["KHOU", "KIAH", "KSGR"],
  SAC: ["KSAC", "KSMF"],
  DFW: ["KDFW", "KDAL"],
  DCA: ["KDCA", "KIAD"],
  BWI: ["KBWI", "KDCA"],
  LAS: ["KLAS", "KHND", "KVGT"],
  SFO: ["KSFO", "KOAK", "KSJC"],
  SAN: ["KSAN", "KNKX", "KMYF"],
  SAT: ["KSAT", "KSSF"],
  OKC: ["KOKC", "KPWA"],
  TUL: ["KTUL", "KRVS"],
  TPA: ["KTPA", "KPIE", "KSPG"],
  MCO: ["KMCO", "KORL"],
  MIA: ["KMIA", "KFLL"],
  MSY: ["KMSY", "KNEW"],
  SEA: ["KSEA", "KBFI"],
  PDX: ["KPDX", "KVUO"],
  PHX: ["KPHX", "KDVT"],
  DEN: ["KDEN", "KAPA", "KBJC"],
  ATL: ["KATL", "KPDK", "KFTY"],
  DTW: ["KDTW", "KDET"],
  STL: ["KSTL", "KCPS"],
  MCI: ["KMCI", "KMKC"],
  CLE: ["KCLE", "KBKL"],
  CMH: ["KCMH", "KLCK"],
  CVG: ["KCVG", "KLUK"],
  IND: ["KIND"],
  MKE: ["KMKE"],
  MSP: ["KMSP", "KSTP"],
  BOS: ["KBOS"],
  PHL: ["KPHL", "KPNE"],
  PIT: ["KPIT", "KAGC"],
  SLC: ["KSLC"],
  ABQ: ["KABQ"],
  TUS: ["KTUS"],
  ANC: ["PANC", "PAMR"],
  BNA: ["KBNA"],
  MEM: ["KMEM"],
  JAX: ["KJAX", "KCRG"],
  RDU: ["KRDU"],
  RIC: ["KRIC"],
  SDF: ["KSDF", "KLOU"],
  OMA: ["KOMA", "KOFF"],
  BHM: ["KBHM"],
  BUF: ["KBUF"],
};

const notes: string[] = [];

// ---------- Gemini events ----------
interface Bin { ticker: string; lo: number; hi: number; yes: boolean }
interface Event { ticker: string; title: string; city: string; date: string; bins: Bin[]; winner: number }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parseBin(t: string): { lo: number; hi: number } | null {
  let m = t.match(/^LO(-?\d+)$/);
  if (m) return { lo: -Infinity, hi: +m[1] };
  m = t.match(/^HI(-?\d+)$/);
  if (m) return { lo: +m[1], hi: Infinity };
  m = t.match(/^(-?\d+)TO(-?\d+)$/);
  if (m) return { lo: +m[1], hi: +m[2] };
  return null;
}

type RawSettled = { ticker: string; title: string; contracts?: { ticker: string; resolutionSide?: string }[] };

async function loadEvents(): Promise<Event[]> {
  const raw: RawSettled[] = [];
  for (let offset = 0; ; offset += 100) {
    const j = JSON.parse(await fetchText(`${GEMINI}/events?status=settled&category=weather&limit=100&offset=${offset}`));
    raw.push(...(j.data ?? []));
    const total = j.pagination?.total ?? 0;
    if (!j.data?.length || offset + 100 >= total) break;
  }
  const out: Event[] = [];
  for (const e of raw) {
    const [kind, city] = String(e.ticker).split("-");
    if (kind !== "WXHIGH") continue;
    const m = String(e.title).match(/on (\w+) (\d+), (\d{4})\?/);
    if (!m || MONTHS.indexOf(m[1]) < 0) {
      notes.push(`Unparsed title ${e.ticker}: ${e.title}`);
      continue;
    }
    const date = `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (date < START || date > END) continue;
    const bins: Bin[] = [];
    for (const c of e.contracts ?? []) {
      const b = parseBin(c.ticker);
      if (!b) {
        notes.push(`Unparsed contract ${e.ticker} ${c.ticker}`);
        continue;
      }
      bins.push({ ticker: c.ticker, ...b, yes: c.resolutionSide === "yes" });
    }
    bins.sort((a, b) => a.lo - b.lo);
    const yes = bins.filter((b) => b.yes);
    if (yes.length !== 1) {
      notes.push(`${e.ticker}: ${yes.length} YES contracts, skipped`);
      continue;
    }
    out.push({ ticker: e.ticker, title: e.title, city, date, bins, winner: bins.indexOf(yes[0]) });
  }
  return out;
}

const inBin = (b: { lo: number; hi: number }, x: number) => x >= b.lo && x <= b.hi;

// ---------- station-map validation ----------
const cliCache = new Map<string, Promise<Map<string, number> | null>>();
function cliFor(id: string) {
  let p = cliCache.get(id);
  if (!p) {
    p = loadCli(id).catch((e) => {
      notes.push(`CLI load failed for ${id}: ${(e as Error).message}`);
      return null;
    });
    cliCache.set(id, p);
  }
  return p;
}

function agreement(events: Event[], cli: Map<string, number> | null) {
  let agree = 0, n = 0;
  const misses: string[] = [];
  if (!cli) return { agree: 0, n: 0, misses };
  for (const e of events) {
    const hi = cli.get(e.date);
    if (hi == null) continue;
    n++;
    if (inBin(e.bins[e.winner], hi)) agree++;
    else misses.push(`${e.date}: CLI ${hi} vs YES ${e.bins[e.winner].ticker}`);
  }
  return { agree: n ? agree / n : 0, n, misses };
}

// ---------- probabilities on real bins ----------
function binProbs(dist: Map<number, number>, bins: Bin[]): number[] {
  return bins.map((b) => {
    let s = 0;
    for (const [k, p] of dist) if (inBin(b, k)) s += p;
    return s;
  });
}

/** Forecast-only distribution truncated to >= floor and renormalized (point mass at floor if no mass survives). */
function truncate(dist: Map<number, number>, floor: number): Map<number, number> {
  const out = new Map<number, number>();
  let tot = 0;
  for (const [k, p] of dist) if (k >= floor) { out.set(k, p); tot += p; }
  if (tot === 0) return new Map([[floor, 1]]);
  for (const [k, p] of out) out.set(k, p / tot);
  return out;
}

interface Scored extends Score { pWin: number }
const avg = (xs: Scored[]) => ({
  brier: round3(mean(xs.map((x) => x.brier))),
  logLoss: round3(mean(xs.map((x) => x.logLoss))),
  acc: round3(mean(xs.map((x) => x.acc))),
  pWin: round3(mean(xs.map((x) => x.pWin))),
});
const scored = (probs: number[], w: number): Scored => ({ ...score(probs, w), pWin: probs[w] });

async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await f(items[k]);
    }
  }));
  return out;
}

// ---------- main ----------
async function main() {
  const events = await loadEvents();
  const byCity = new Map<string, Event[]>();
  for (const e of events) byCity.set(e.city, [...(byCity.get(e.city) ?? []), e]);
  const cities = [...byCity.keys()].sort();
  process.stderr.write(`${events.length} settled WXHIGH events ${START}..${END}, ${cities.length} cities\n`);

  // 1. station check
  const stationCheck: { city: string; station: string; agree: number; n: number; misses: string[]; bestAlternate?: { station: string; agree: number; n: number }; alternatesTried?: { station: string; agree: number; n: number }[] }[] = [];
  const replayStation = new Map<string, string>();
  await pool(cities, 4, async (city) => {
    const mapped = stationFor(city);
    const a = agreement(byCity.get(city)!, await cliFor(mapped));
    const row: (typeof stationCheck)[number] = { city, station: mapped, agree: round3(a.agree), n: a.n, misses: a.misses };
    replayStation.set(city, mapped);
    if (a.agree < AGREE_THRESHOLD || a.n === 0) {
      const tried = [];
      for (const alt of ALTERNATES[city] ?? []) {
        if (alt === mapped) continue;
        const b = agreement(byCity.get(city)!, await cliFor(alt));
        tried.push({ station: alt, agree: round3(b.agree), n: b.n });
      }
      row.alternatesTried = tried;
      const best = tried.filter((t) => t.n > 0).sort((x, y) => y.agree - x.agree)[0];
      if (best) {
        row.bestAlternate = best;
        if (best.agree > a.agree) replayStation.set(city, best.station);
      }
    }
    stationCheck.push(row);
  });
  // Control: score alternates for a few cities even though the mapped station already agrees, to
  // show the check can tell neighbouring stations apart.
  const CONTROL = ["NYC", "CHI", "LA", "AUS", "HOU", "SAC", "DFW", "DCA", "LAS", "SFO", "SAN"];
  const controlAlternates: { city: string; station: string; agree: number; n: number }[] = [];
  for (const city of CONTROL.filter((c) => byCity.has(c)))
    for (const alt of ALTERNATES[city] ?? []) {
      if (alt === stationFor(city)) continue;
      const b = agreement(byCity.get(city)!, await cliFor(alt));
      controlAlternates.push({ city, station: alt, agree: round3(b.agree), n: b.n });
    }
  stationCheck.sort((x, y) => x.agree - y.agree || x.city.localeCompare(y.city));
  for (const r of stationCheck)
    process.stderr.write(`station ${r.city} ${r.station} agree=${r.agree} n=${r.n}${r.bestAlternate ? ` best alt ${r.bestAlternate.station}=${r.bestAlternate.agree}` : ""}\n`);

  // 2. load replay data (ASOS + forecast) once per replay station
  const stations = new Map<string, Station>();
  await pool([...new Set(replayStation.values())], 3, async (id) => {
    try {
      const cli = (await cliFor(id)) ?? undefined;
      stations.set(id, await loadStation(id, START, END, cli));
      process.stderr.write(`loaded ${id}\n`);
    } catch (e) {
      notes.push(`Failed to load ${id}: ${(e as Error).message}`);
    }
  });

  // Build days (one per event) on the replay station.
  const evDays: { e: Event; d: Day }[] = [];
  const skippedTickers: string[] = [];
  for (const e of events) {
    const st = stations.get(replayStation.get(e.city)!);
    const d = st ? buildDay(st, e.date) : null;
    if (d) evDays.push({ e, d });
    else skippedTickers.push(e.ticker);
  }
  if (skippedTickers.length) notes.push(`${skippedTickers.length} events skipped (missing CLI, forecast or METARs for the replay station): ${skippedTickers.join(", ")}.`);

  // Calibration, same recipe as backtest.ts: forecast-only station bias leave-one-day-out, global sd
  // in-sample; nowcast hour bias leave-one-day-out; peak uplift from all station-days.
  const days = evDays.map((x) => x.d);
  const byStation = new Map<string, Day[]>();
  for (const d of days) byStation.set(d.station, [...(byStation.get(d.station) ?? []), d]);
  const resid = (d: Day) => d.truth - Math.max(...d.fcstHours);
  const looBias = (d: Day) => {
    const others = byStation.get(d.station)!.filter((o) => o !== d);
    return others.length ? mean(others.map(resid)) : 0;
  };
  const foSd = Math.sqrt(mean(days.map((d) => (resid(d) - looBias(d)) ** 2)));
  const hourly = new Map<Day, number[]>(days.map((d) => [d, hourlyObs(d)]));
  const hourBias = (d: Day) => {
    const others = byStation.get(d.station)!.filter((o) => o !== d);
    return Array.from({ length: 24 }, (_, h) => {
      const r = others.map((o) => hourly.get(o)![h] - o.fcstHours[h]).filter((x) => !Number.isNaN(x));
      return r.length ? mean(r) : 0;
    });
  };
  const upliftRaw = days.map((d) => d.truth - Math.max(...d.obs.map((o) => o.f)));
  const uplift = upliftRaw.map((u) => Math.max(0, u)).sort((a, b) => a - b);

  // Nowcast noise params: taken from public/backtest.json (fitted on other station-days), so they are
  // not tuned on these contracts.
  let noise: NoiseParams = { base: 0.25, perHour: 0.1, cap: 4, iid: 0.5, decay: 0.85, biasWindowHours: 3 };
  const btFile = path.join(process.cwd(), "public", "backtest.json");
  if (existsSync(btFile)) {
    const p = JSON.parse(readFileSync(btFile, "utf8")).params?.nowcastNoise;
    if (p) noise = { base: p.base, perHour: p.perHour, cap: p.cap, iid: p.iid, decay: p.decay, biasWindowHours: p.biasWindowHours };
  } else notes.push("public/backtest.json missing; used default nowcast noise params.");

  // 3. replay + score
  const res = AS_OF_HOURS.map((hour) => ({ hour, now: [] as Scored[], floor: [] as Scored[], fo: [] as Scored[] }));
  const deadByHour = AS_OF_HOURS.map((hour) => ({ hour, ruledOut: 0, resolvedNo: 0 }));
  const deadUnique = new Map<string, { e: Event; b: Bin; hour: number; floor: number; observedMax: number; cli: number }>();
  const rows: { e: Event; hour: number; observedMax: number; nowP: number; foP: number; floorP: number }[] = [];
  for (const { e, d } of evDays) {
    const foDist = forecastOnly(d, looBias(d), foSd);
    const foProbs = binProbs(foDist, e.bins);
    const hb = hourBias(d);
    for (const r of res) {
      const seen = d.obs.filter((o) => o.h < r.hour);
      const nc = nowcast(d, r.hour, noise, hb, uplift);
      if (!nc || !seen.length) continue;
      const observedMax = Math.max(...seen.map((o) => o.f));
      const floor = Math.round(observedMax);
      const ncProbs = binProbs(nc, e.bins);
      const flProbs = binProbs(truncate(foDist, floor), e.bins);
      r.now.push(scored(ncProbs, e.winner));
      r.floor.push(scored(flProbs, e.winner));
      r.fo.push(scored(foProbs, e.winner));
      rows.push({ e, hour: r.hour, observedMax, nowP: ncProbs[e.winner], foP: foProbs[e.winner], floorP: flProbs[e.winner] });
      const dh = deadByHour.find((x) => x.hour === r.hour)!;
      for (const b of e.bins)
        if (b.hi < floor) {
          dh.ruledOut++;
          if (!b.yes) dh.resolvedNo++;
          const key = `${e.ticker}/${b.ticker}`;
          if (!deadUnique.has(key)) deadUnique.set(key, { e, b, hour: r.hour, floor, observedMax, cli: d.truth });
        }
    }
  }

  // Floor rounding diagnostic over full LST days: is round(max METAR) ever above the CLI high?
  const fullMax = (d: Day) => Math.max(...d.obs.map((o) => o.f));
  const belowRound = evDays.filter(({ d }) => d.truth < Math.round(fullMax(d)));
  const belowTrunc = evDays.filter(({ d }) => d.truth < Math.floor(fullMax(d)));
  const floorCheck = {
    stationDays: evDays.length,
    cliBelowRoundedMetarMax: belowRound.length,
    cliBelowTruncatedMetarMax: belowTrunc.length,
    cases: belowRound.map(({ e, d }) => ({ event: e.ticker, station: d.station, date: d.date, metarMax: fullMax(d), cliHigh: d.truth })),
  };
  // Same dead-contract count with floor = Math.floor(max METAR) instead of Math.round.
  const deadTrunc = new Map<string, boolean>();
  for (const { e, d } of evDays)
    for (const hour of AS_OF_HOURS) {
      const seen = d.obs.filter((o) => o.h < hour);
      if (!seen.length) continue;
      const fl = Math.floor(Math.max(...seen.map((o) => o.f)));
      for (const b of e.bins) if (b.hi < fl) deadTrunc.set(`${e.ticker}/${b.ticker}`, b.yes);
    }

  const byAsOfHour = res.map((r) => ({ hour: r.hour, n: r.now.length, nowcast: avg(r.now), floorOnly: avg(r.floor), forecastOnly: avg(r.fo) }));
  const deadList = [...deadUnique.values()];
  const exceptions = deadList
    .filter((x) => x.b.yes)
    .map((x) => ({ event: x.e.ticker, contract: x.b.ticker, firstRuledOutAt: x.hour, floor: x.floor, observedMax: x.observedMax, cliHigh: x.cli, station: replayStation.get(x.e.city) }));

  // Examples: biggest nowcast gains over forecast-only (late in the day), plus the worst nowcast misses.
  const late = rows.filter((r) => r.hour >= 15);
  const gains = [...late].sort((a, b) => b.nowP - b.foP - (a.nowP - a.foP));
  const picked: typeof rows = [];
  const seenEv = new Set<string>();
  for (const r of gains) {
    if (picked.length >= 4) break;
    if (!seenEv.has(r.e.ticker)) { picked.push(r); seenEv.add(r.e.ticker); }
  }
  for (const r of [...late].sort((a, b) => a.nowP - a.foP - (b.nowP - b.foP))) {
    if (picked.length >= 6) break;
    if (!seenEv.has(r.e.ticker)) { picked.push(r); seenEv.add(r.e.ticker); }
  }
  const examples = picked.map((r) => ({
    ticker: r.e.ticker,
    title: r.e.title,
    asOfHour: r.hour,
    observedMax: round3(r.observedMax),
    winner: r.e.bins[r.e.winner].ticker,
    nowcastPWin: round3(r.nowP),
    forecastPWin: round3(r.foP),
    floorOnlyPWin: round3(r.floorP),
  }));

  const recommended = stationCheck.filter((r) => replayStation.get(r.city) !== r.station).map((r) => `${r.city}->${replayStation.get(r.city)}`);
  const out = {
    generatedAt: new Date().toISOString(),
    period: { start: START, end: END },
    events: evDays.length,
    eventsLoaded: events.length,
    cities: new Set(evDays.map((x) => x.e.city)).size,
    stationCheck: stationCheck.map(({ misses, ...r }) => ({ ...r, misses: misses.slice(0, 5), replayStation: replayStation.get(r.city) })),
    controlAlternates,
    byAsOfHour,
    dead: {
      ruledOut: deadList.length,
      resolvedNo: deadList.filter((x) => !x.b.yes).length,
      exceptions,
      byHour: deadByHour,
      withTruncatedFloor: { ruledOut: deadTrunc.size, resolvedNo: [...deadTrunc.values()].filter((y) => !y).length },
      floorCheck,
      note: "ruledOut/resolvedNo count unique contracts whose upper bound was below round(max METAR so far) at any as-of hour; byHour counts per (event, hour).",
    },
    examples,
    params: { nowcastNoise: noise, forecastOnlySd: round3(foSd), upliftMean: round3(mean(uplift)) },
    notes: [
      `Bins and outcomes: real settled Gemini WXHIGH contracts (api.gemini.com/v1/prediction-markets/events?status=settled&category=weather); truth = the contract Gemini resolved YES.`,
      `Station check: NWS CLI high (IEM json/cli.py) of the mapped station (src/lib/stations.ts stationFor) must fall in the YES contract. Cities under ${AGREE_THRESHOLD * 100}% were tried against alternates; the better-matching station is used for the replay.${recommended.length ? ` Recommended stationFor overrides: ${recommended.join(", ")}.` : " No overrides needed."}`,
      `Replay: as of ${AS_OF_HOURS.join("/")} local standard time, METARs before that time only. Models identical to scripts/backtest.ts (lib-replay.ts). Nowcast noise params come from public/backtest.json (fitted on a different set of station-days, not tuned here). Forecast-only station bias and nowcast hour bias are leave-one-day-out; forecast-only sd (${round3(foSd)}) and the peak-uplift distribution are in-sample over these station-days.`,
      `floorOnly = forecast-only distribution truncated to >= round(max METAR so far) and renormalized.`,
      `Forecast: Open-Meteo historical-forecast GFS, which behaves like a short-lead forecast and flatters forecast-only.`,
      ...notes,
    ].join(" "),
  };

  const file = path.join(process.cwd(), "public", "realcontracts.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(`\nHighwater on real Gemini contracts ${START}..${END}: ${evDays.length} events scored (${events.length} loaded), ${out.cities} cities`);
  console.log(`noise: ${JSON.stringify(noise)}; forecast-only sd=${foSd.toFixed(2)}\n`);
  console.log("station check (agreement of mapped CLI with Gemini YES):");
  for (const r of stationCheck)
    console.log(`  ${r.city.padEnd(4)} ${r.station} ${(r.agree * 100).toFixed(0).padStart(3)}% n=${r.n}` +
      (r.alternatesTried ? `  alts: ${r.alternatesTried.map((t) => `${t.station}=${(t.agree * 100).toFixed(0)}%/${t.n}`).join(" ")}` : ""));
  console.log("\nasOf   n   | Brier now / floor / fcst | LogLoss now / floor / fcst | Acc now / floor / fcst | pWin now / floor / fcst");
  type Row = Record<string, number>;
  const f = (x: { nowcast: Row; floorOnly: Row; forecastOnly: Row }, k: string) =>
    `${x.nowcast[k].toFixed(3)} / ${x.floorOnly[k].toFixed(3)} / ${x.forecastOnly[k].toFixed(3)}`;
  for (const r of byAsOfHour)
    console.log(`${String(r.hour).padStart(2)}:00 ${String(r.n).padStart(4)} | ${f(r, "brier")} | ${f(r, "logLoss")}  | ${f(r, "acc")} | ${f(r, "pWin")}`);
  console.log(`\ndead contracts: ${out.dead.ruledOut} ruled out, ${out.dead.resolvedNo} resolved NO, ${exceptions.length} exceptions`);
  for (const x of exceptions) console.log(`  EXCEPTION ${JSON.stringify(x)}`);
  console.log(`  with floor = Math.floor(max METAR): ${out.dead.withTruncatedFloor.ruledOut} ruled out, ${out.dead.withTruncatedFloor.resolvedNo} resolved NO`);
  console.log(`  full-day check: CLI < round(max METAR) on ${floorCheck.cliBelowRoundedMetarMax}/${floorCheck.stationDays} days, CLI < floor(max METAR) on ${floorCheck.cliBelowTruncatedMetarMax}`);
  for (const c of floorCheck.cases) console.log(`    ${JSON.stringify(c)}`);
  console.log("\ncontrol alternates (should disagree):");
  for (const c of controlAlternates) console.log(`  ${c.city.padEnd(4)} ${c.station} ${(c.agree * 100).toFixed(0)}% n=${c.n}`);
  console.log("\nexamples:");
  for (const x of examples) console.log(`  ${JSON.stringify(x)}`);
  if (notes.length) console.log(`\nnotes: ${notes.join(" | ")}`);
  console.log(`\nwrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
