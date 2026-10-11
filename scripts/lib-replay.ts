/**
 * Shared replay pieces for the Highwater backtests (scripts/backtest.ts, scripts/realcontracts.ts):
 * data loading (NWS station meta, IEM CLI truth, IEM ASOS METARs, Open-Meteo historical GFS),
 * per-day LST views, and the nowcast / forecast-only Monte Carlo models.
 *
 * The PRNG is a module-level singleton with a fixed seed so each script run is reproducible.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const UA = "highwater-hackathon/0.1";
export const N_SAMPLES = 2000;
export const HOUR_MS = 3600_000;
export const DAY_MS = 24 * HOUR_MS;

// ---------- small utils ----------
/**
 * GET with retries. If HIGHWATER_CACHE_DIR is set, responses are cached on disk keyed by URL
 * (handy when iterating on a script; unset by default so runs fetch live data).
 */
export async function fetchText(url: string, tries = 3): Promise<string> {
  const dir = process.env.HIGHWATER_CACHE_DIR;
  if (!dir) return fetchLive(url, tries);
  const file = path.join(dir, createHash("sha1").update(url).digest("hex") + ".txt");
  if (existsSync(file)) return readFileSync(file, "utf8");
  const text = await fetchLive(url, tries);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, text);
  return text;
}

async function fetchLive(url: string, tries: number): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i >= tries - 1) throw new Error(`${url}: ${(e as Error).message}`);
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}

/** Seeded PRNG (mulberry32) so the backtest is reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = rng(20261011);
export function gauss(): number {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** UTC offset in minutes of a time zone at a given instant (e.g. -300 for EST). */
export function tzOffsetMin(tz: string, at: Date): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")!.value; // "GMT-05:00" or "GMT"
  const m = s.match(/GMT([+-])(\d\d):(\d\d)/);
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
}
/** Standard-time offset: the smaller of Jan/Jul offsets (US zones). CLI uses LST year-round. */
export const stdOffsetMin = (tz: string) =>
  Math.min(tzOffsetMin(tz, new Date("2026-01-15T12:00Z")), tzOffsetMin(tz, new Date("2026-07-15T12:00Z")));

export function dateList(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(start + "T00:00Z"); t <= Date.parse(end + "T00:00Z"); t += DAY_MS)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
export const shiftDate = (d: string, days: number) => new Date(Date.parse(d + "T00:00Z") + days * DAY_MS).toISOString().slice(0, 10);

// ---------- data loading ----------
export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tz: string;
  stdOffsetMin: number;
  cli: Map<string, number>; // date -> official max °F
  obs: { t: number; f: number }[]; // UTC ms, °F, sorted
  fcst: Map<number, number>; // UTC hour ms -> °F
}

/** IEM ASOS ids drop the leading K for CONUS stations but keep 4 letters elsewhere (PANC). */
export const asosId = (id: string) => (id.startsWith("K") ? id.slice(1) : id);

/** Official CLI daily highs for a station-year (IEM json/cli.py): date -> °F. */
export async function loadCli(id: string, year = 2026): Promise<Map<string, number>> {
  const cli = new Map<string, number>();
  const cliJson = JSON.parse(await fetchText(`https://mesonet.agron.iastate.edu/json/cli.py?station=${id}&year=${year}`));
  for (const r of cliJson.results ?? []) if (typeof r.high === "number") cli.set(r.valid, r.high);
  return cli;
}

export async function loadStation(id: string, start: string, end: string, cliIn?: Map<string, number>): Promise<Station> {
  const meta = JSON.parse(await fetchText(`https://api.weather.gov/stations/${id}`));
  const [lon, lat] = meta.geometry.coordinates as [number, number];
  const tz = meta.properties.timeZone as string;

  const cli = cliIn ?? (await loadCli(id));

  // Pad by a day each side so local-standard-time days are fully covered in UTC.
  const s = shiftDate(start, -1), e = shiftDate(end, 2);
  const [y1, m1, d1] = s.split("-").map(Number), [y2, m2, d2] = e.split("-").map(Number);
  const asosUrl =
    `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${asosId(id)}&data=tmpf` +
    `&year1=${y1}&month1=${m1}&day1=${d1}&year2=${y2}&month2=${m2}&day2=${d2}` +
    `&tz=Etc/UTC&format=onlycomma&missing=M&report_type=3&report_type=4`;
  const obs: { t: number; f: number }[] = [];
  for (const line of (await fetchText(asosUrl)).split("\n").slice(1)) {
    const [, valid, tmpf] = line.split(",");
    if (!valid || !tmpf || tmpf.trim() === "M") continue;
    obs.push({ t: Date.parse(valid.replace(" ", "T") + ":00Z"), f: parseFloat(tmpf) });
  }
  obs.sort((a, b) => a.t - b.t);

  const omUrl =
    `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m&temperature_unit=fahrenheit&start_date=${s}&end_date=${shiftDate(end, 1)}` +
    `&timezone=GMT&models=gfs_seamless`;
  const om = JSON.parse(await fetchText(omUrl));
  const fcst = new Map<number, number>();
  om.hourly.time.forEach((t: string, i: number) => {
    const v = om.hourly.temperature_2m[i];
    if (v != null) fcst.set(Date.parse(t + ":00Z"), v);
  });

  return { id, name: meta.properties.name, lat, lon, tz, stdOffsetMin: stdOffsetMin(tz), cli, obs, fcst };
}

// ---------- per-day views ----------
export interface Day {
  station: string;
  date: string;
  truth: number;
  fcstHours: number[]; // 24 forecast temps, index = LST hour
  obs: { h: number; f: number }[]; // obs within the LST day, h = fractional LST hour
}

export function buildDay(st: Station, date: string): Day | null {
  const truth = st.cli.get(date);
  if (truth == null) return null;
  const t0 = Date.parse(date + "T00:00Z") - st.stdOffsetMin * 60_000; // LST midnight in UTC
  const fcstHours: number[] = [];
  for (let h = 0; h < 24; h++) {
    const v = st.fcst.get(t0 + h * HOUR_MS);
    if (v == null) return null;
    fcstHours.push(v);
  }
  const obs = st.obs.filter((o) => o.t >= t0 && o.t < t0 + DAY_MS).map((o) => ({ h: (o.t - t0) / HOUR_MS, f: o.f }));
  if (obs.length < 12) return null;
  return { station: st.id, date, truth, fcstHours, obs };
}

// ---------- models ----------
export interface NoiseParams { base: number; perHour: number; cap: number; iid: number; decay: number; biasWindowHours: number }
export const leadSd = (p: NoiseParams, lead: number) => Math.min(p.cap, p.base + p.perHour * lead);

/** Draw from an empirical distribution. */
export const drawEmpirical = (xs: number[]) => xs[Math.floor(rand() * xs.length)];

/** Histogram of integer highs from Monte Carlo samples -> Map<int, prob>. */
export function toDist(samples: Float64Array): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of samples) {
    const k = Math.round(s);
    m.set(k, (m.get(k) ?? 0) + 1 / samples.length);
  }
  return m;
}

/**
 * Forecast-only: high = max hourly forecast + station bias (leave-one-day-out mean of
 * CLI - forecast max, which also absorbs the hourly-vs-peak gap) + Gaussian noise.
 */
export function forecastOnly(day: Day, stationBias: number, sd: number): Map<number, number> {
  const fmax = Math.max(...day.fcstHours);
  const out = new Float64Array(N_SAMPLES);
  for (let i = 0; i < N_SAMPLES; i++) out[i] = fmax + stationBias + sd * gauss();
  return toDist(out);
}

/** Obs averaged within +-30 min of each whole LST hour (NaN where none). */
export function hourlyObs(day: Day): number[] {
  return Array.from({ length: 24 }, (_, h) => {
    const near = day.obs.filter((o) => Math.abs(o.h - h) <= 0.5);
    return near.length ? mean(near.map((o) => o.f)) : NaN;
  });
}

/**
 * Nowcast (Highwater):
 *  1. climatological correction: forecast + station's typical (obs - forecast) at that LST hour
 *     (leave-one-day-out), which fixes the model's diurnal bias;
 *  2. today's anomaly: mean residual over the last `biasWindowHours` elapsed hours, carried
 *     forward with weight decay^lead;
 *  3. high = max(observed max so far, simulated max of remaining hours) + unobserved-peak uplift.
 * Noise = one shared shock scaled by lead-time sd (forecast errors are strongly correlated
 * hour to hour) plus a small iid per-hour term.
 *
 * Note: hourlyObs() uses the whole day's obs, but only hours < asOf are read, and an hour-h
 * bucket can include obs up to h+0.5; with asOf an integer the last bucket read is asOf-1,
 * so at most obs before asOf-0.5 are used. No look-ahead.
 */
export function nowcast(day: Day, asOf: number, p: NoiseParams, hourBias: number[], uplift: number[]): Map<number, number> | null {
  const seen = day.obs.filter((o) => o.h < asOf);
  if (seen.length === 0) return null;
  const obsMax = Math.max(...seen.map((o) => o.f));
  const ho = hourlyObs(day);
  const res: number[] = [];
  for (let h = Math.max(0, asOf - p.biasWindowHours); h < asOf; h++)
    if (!Number.isNaN(ho[h])) res.push(ho[h] - day.fcstHours[h] - hourBias[h]);
  const anomaly = res.length ? mean(res) : 0;
  const out = new Float64Array(N_SAMPLES);
  for (let i = 0; i < N_SAMPLES; i++) {
    const z = gauss();
    let m = obsMax;
    for (let h = asOf; h < 24; h++) {
      const lead = h - asOf + 1;
      const v = day.fcstHours[h] + hourBias[h] + anomaly * p.decay ** lead + leadSd(p, lead) * z + p.iid * gauss();
      if (v > m) m = v;
    }
    out[i] = m + drawEmpirical(uplift);
  }
  return toDist(out);
}

// ---------- scoring ----------
export interface Score { brier: number; logLoss: number; acc: number }
export function score(probs: number[], truthIdx: number): Score {
  const brier = probs.reduce((s, p, i) => s + (p - (i === truthIdx ? 1 : 0)) ** 2, 0);
  const logLoss = -Math.log(Math.max(1e-3, probs[truthIdx]));
  const argmax = probs.indexOf(Math.max(...probs));
  return { brier, logLoss, acc: argmax === truthIdx ? 1 : 0 };
}
export const avgScore = (xs: Score[]): Score => ({
  brier: round3(mean(xs.map((x) => x.brier))),
  logLoss: round3(mean(xs.map((x) => x.logLoss))),
  acc: round3(mean(xs.map((x) => x.acc))),
});
