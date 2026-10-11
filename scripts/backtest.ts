/**
 * Highwater backtest: does conditioning on today's observations sharpen the
 * daily-high distribution versus a forecast-only model?
 *
 * Run: npx tsx scripts/backtest.ts
 * Output: public/backtest.json + a summary table on stdout.
 *
 * Data (all real, fetched live):
 *  - Station metadata: api.weather.gov/stations/{ID}
 *  - Truth: NWS CLI daily max via IEM json/cli.py
 *  - Observations: IEM ASOS archive (routine + special METARs)
 *  - Forecast: Open-Meteo historical forecast API, GFS (gfs_seamless), hourly
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const UA = "highwater-hackathon/0.1";
const STATIONS = ["KNYC", "KMDW", "KMIA", "KLAX", "KBOS", "KATL", "KDEN", "KDFW", "KPHX", "KSEA", "KMSP", "KPHL"];
const START = "2026-09-10";
const END = "2026-10-10";
const AS_OF_HOURS = [9, 12, 15, 18];
const N_SAMPLES = 2000;
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

// ---------- small utils ----------
const notes: string[] = [];

async function fetchText(url: string, tries = 3): Promise<string> {
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
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261011);
function gauss(): number {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** UTC offset in minutes of a time zone at a given instant (e.g. -300 for EST). */
function tzOffsetMin(tz: string, at: Date): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")!.value; // "GMT-05:00" or "GMT"
  const m = s.match(/GMT([+-])(\d\d):(\d\d)/);
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
}
/** Standard-time offset: the smaller of Jan/Jul offsets (US zones). CLI uses LST year-round. */
const stdOffsetMin = (tz: string) =>
  Math.min(tzOffsetMin(tz, new Date("2026-01-15T12:00Z")), tzOffsetMin(tz, new Date("2026-07-15T12:00Z")));

function dateList(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(start + "T00:00Z"); t <= Date.parse(end + "T00:00Z"); t += DAY_MS)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
const shiftDate = (d: string, days: number) => new Date(Date.parse(d + "T00:00Z") + days * DAY_MS).toISOString().slice(0, 10);

// ---------- data loading ----------
interface Station {
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

async function loadStation(id: string): Promise<Station> {
  const meta = JSON.parse(await fetchText(`https://api.weather.gov/stations/${id}`));
  const [lon, lat] = meta.geometry.coordinates as [number, number];
  const tz = meta.properties.timeZone as string;

  const cli = new Map<string, number>();
  const cliJson = JSON.parse(await fetchText(`https://mesonet.agron.iastate.edu/json/cli.py?station=${id}&year=2026`));
  for (const r of cliJson.results ?? []) if (typeof r.high === "number") cli.set(r.valid, r.high);

  // Pad by a day each side so local-standard-time days are fully covered in UTC.
  const s = shiftDate(START, -1), e = shiftDate(END, 2);
  const [y1, m1, d1] = s.split("-").map(Number), [y2, m2, d2] = e.split("-").map(Number);
  const asosUrl =
    `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${id.slice(1)}&data=tmpf` +
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
    `&hourly=temperature_2m&temperature_unit=fahrenheit&start_date=${s}&end_date=${shiftDate(END, 1)}` +
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
interface Day {
  station: string;
  date: string;
  truth: number;
  fcstHours: number[]; // 24 forecast temps, index = LST hour
  obs: { h: number; f: number }[]; // obs within the LST day, h = fractional LST hour
}

function buildDay(st: Station, date: string): Day | null {
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
interface NoiseParams { base: number; perHour: number; cap: number; iid: number; decay: number; biasWindowHours: number }
const leadSd = (p: NoiseParams, lead: number) => Math.min(p.cap, p.base + p.perHour * lead);

/** Draw from an empirical distribution. */
const drawEmpirical = (xs: number[]) => xs[Math.floor(rand() * xs.length)];

/** Histogram of integer highs from Monte Carlo samples -> Map<int, prob>. */
function toDist(samples: Float64Array): Map<number, number> {
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
function forecastOnly(day: Day, stationBias: number, sd: number): Map<number, number> {
  const fmax = Math.max(...day.fcstHours);
  const out = new Float64Array(N_SAMPLES);
  for (let i = 0; i < N_SAMPLES; i++) out[i] = fmax + stationBias + sd * gauss();
  return toDist(out);
}

/** Obs averaged within +-30 min of each whole LST hour (NaN where none). */
function hourlyObs(day: Day): number[] {
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
 */
function nowcast(day: Day, asOf: number, p: NoiseParams, hourBias: number[], uplift: number[]): Map<number, number> | null {
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
/** Gemini-style bins: 5 interior 2°F bins centered on `center`, plus two open tails. */
function makeBins(center: number): { lo: number; hi: number; label: string }[] {
  const L = center - 5;
  const bins = [{ lo: -Infinity, hi: L - 1, label: `${L - 1}°F or below` }];
  for (let k = 0; k < 5; k++) bins.push({ lo: L + 2 * k, hi: L + 2 * k + 1, label: `${L + 2 * k}°F to ${L + 2 * k + 1}°F` });
  bins.push({ lo: L + 10, hi: Infinity, label: `${L + 10}°F or above` });
  return bins;
}
function binProbs(dist: Map<number, number>, bins: ReturnType<typeof makeBins>): number[] {
  return bins.map((b) => {
    let s = 0;
    for (const [k, p] of dist) if (k >= b.lo && k <= b.hi) s += p;
    return s;
  });
}
function median(dist: Map<number, number>): number {
  let c = 0;
  for (const k of [...dist.keys()].sort((a, b) => a - b)) {
    c += dist.get(k)!;
    if (c >= 0.5) return k;
  }
  return 0;
}
interface Score { brier: number; logLoss: number; acc: number }
function score(probs: number[], truthIdx: number): Score {
  const brier = probs.reduce((s, p, i) => s + (p - (i === truthIdx ? 1 : 0)) ** 2, 0);
  const logLoss = -Math.log(Math.max(1e-3, probs[truthIdx]));
  const argmax = probs.indexOf(Math.max(...probs));
  return { brier, logLoss, acc: argmax === truthIdx ? 1 : 0 };
}
const avgScore = (xs: Score[]): Score => ({
  brier: round3(mean(xs.map((x) => x.brier))),
  logLoss: round3(mean(xs.map((x) => x.logLoss))),
  acc: round3(mean(xs.map((x) => x.acc))),
});

// ---------- main ----------
async function main() {
  const stations: Station[] = [];
  for (const id of STATIONS) {
    try {
      stations.push(await loadStation(id));
      process.stderr.write(`loaded ${id}\n`);
    } catch (e) {
      const msg = `Failed to load ${id}: ${(e as Error).message}`;
      notes.push(msg);
      console.error(msg);
    }
  }

  const dates = dateList(START, END);
  const days: Day[] = [];
  for (const st of stations)
    for (const d of dates) {
      const day = buildDay(st, d);
      if (day) days.push(day);
      else notes.push(`Skipped ${st.id} ${d} (missing CLI, forecast, or obs)`);
    }

  // Unobserved-peak uplift: CLI max minus max of all METARs (routine + special) over the full LST day.
  const upliftRaw = days.map((d) => d.truth - Math.max(...d.obs.map((o) => o.f)));
  const uplift = upliftRaw.map((u) => Math.max(0, u)).sort((a, b) => a - b);
  const negUplift = upliftRaw.filter((u) => u < 0).length;

  // Forecast-only calibration: per-station bias (leave-one-day-out) and global residual sd.
  const resid = (d: Day) => d.truth - Math.max(...d.fcstHours);
  const byStation = new Map<string, Day[]>();
  for (const d of days) byStation.set(d.station, [...(byStation.get(d.station) ?? []), d]);
  const looBias = (d: Day) => {
    const others = byStation.get(d.station)!.filter((o) => o !== d);
    return mean(others.map(resid));
  };
  const foResid = days.map((d) => resid(d) - looBias(d));
  const foSd = Math.sqrt(mean(foResid.map((r) => r * r)));

  // Nowcast diurnal correction: per-station, per-LST-hour mean (obs - forecast), leave-one-day-out.
  const hourly = new Map<Day, number[]>(days.map((d) => [d, hourlyObs(d)]));
  const hourBiasCache = new Map<Day, number[]>();
  const hourBias = (d: Day) => {
    if (hourBiasCache.has(d)) return hourBiasCache.get(d)!;
    const others = byStation.get(d.station)!.filter((o) => o !== d);
    const hb = Array.from({ length: 24 }, (_, h) => {
      const r = others.map((o) => hourly.get(o)![h] - o.fcstHours[h]).filter((x) => !Number.isNaN(x));
      return r.length ? mean(r) : 0;
    });
    hourBiasCache.set(d, hb);
    return hb;
  };

  // Nowcast noise: small grid search on mean log loss (in-sample; noted in output).
  const grid: NoiseParams[] = [];
  for (const base of [0.25, 0.5, 1.0])
    for (const perHour of [0.1, 0.2])
      for (const decay of [0.85, 0.95, 1.0]) grid.push({ base, perHour, cap: 4, iid: 0.5, decay, biasWindowHours: 3 });
  const evalNowcast = (p: NoiseParams) => {
    const ll: number[] = [];
    for (const d of days)
      for (const h of AS_OF_HOURS) {
        const nc = nowcast(d, h, p, hourBias(d), uplift);
        if (!nc) continue;
        ll.push(nc.get(d.truth) ? -Math.log(Math.max(1e-3, nc.get(d.truth)!)) : -Math.log(1e-3));
      }
    return mean(ll);
  };
  let best = grid[0], bestLL = Infinity;
  for (const p of grid) {
    const ll = evalNowcast(p);
    process.stderr.write(`noise base=${p.base} perHour=${p.perHour} decay=${p.decay}: exact-degree logLoss ${ll.toFixed(3)}\n`);
    if (ll < bestLL) [best, bestLL] = [p, ll];
  }

  // Score both models on Gemini-style bins.
  const results = AS_OF_HOURS.map((hour) => ({ hour, now: [] as Score[], fo: [] as Score[] }));
  const calib = Array.from({ length: 10 }, () => ({ pSum: 0, hits: 0, n: 0 }));
  for (const d of days) {
    const fo = forecastOnly(d, looBias(d), foSd);
    const bins = makeBins(median(fo));
    const truthIdx = bins.findIndex((b) => d.truth >= b.lo && d.truth <= b.hi);
    const foProbs = binProbs(fo, bins);
    for (const r of results) {
      const nc = nowcast(d, r.hour, best, hourBias(d), uplift);
      if (!nc) continue;
      const ncProbs = binProbs(nc, bins);
      r.now.push(score(ncProbs, truthIdx));
      r.fo.push(score(foProbs, truthIdx));
      ncProbs.forEach((p, i) => {
        const c = calib[Math.min(9, Math.floor(p * 10))];
        c.pSum += p;
        c.hits += i === truthIdx ? 1 : 0;
        c.n++;
      });
    }
  }

  const byAsOfHour = results.map((r) => ({ hour: r.hour, n: r.now.length, nowcast: avgScore(r.now), forecastOnly: avgScore(r.fo) }));
  const calibration = calib.map((c, i) => ({
    bucket: round3(i / 10 + 0.05),
    predicted: c.n ? round3(c.pSum / c.n) : null,
    observed: c.n ? round3(c.hits / c.n) : null,
    n: c.n,
  }));
  const peakUplift = {
    mean: round3(mean(uplift)),
    p50: quantile(uplift, 0.5),
    p90: quantile(uplift, 0.9),
  };
  // Compact empirical uplift pmf for the live engine.
  const upliftPmf: Record<string, number> = {};
  for (const u of uplift) upliftPmf[String(Math.round(u))] = (upliftPmf[String(Math.round(u))] ?? 0) + 1;
  for (const k of Object.keys(upliftPmf)) upliftPmf[k] = round3(upliftPmf[k] / uplift.length);

  const skipped = notes.filter((n) => n.startsWith("Skipped")).length;
  const out = {
    generatedAt: new Date().toISOString(),
    days: dates.length,
    stationDays: days.length,
    period: { start: START, end: END },
    stations: stations.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, tz: s.tz, stdUtcOffsetMin: s.stdOffsetMin })),
    byAsOfHour,
    calibration,
    peakUplift,
    params: {
      nowcastNoise: {
        ...best,
        formula:
          "temp[h] = fcst[h] + hourBias[station][h] + anomaly * decay^lead + sd(lead) * z + N(0, iid); sd(lead) = min(cap, base + perHour * leadHours); z shared across hours per sample; anomaly = mean(obs - fcst - hourBias) over last biasWindowHours",
        hourBias: Object.fromEntries(
          [...byStation].map(([id, ds]) => [
            id,
            Array.from({ length: 24 }, (_, h) => {
              const r = ds.map((o) => hourly.get(o)![h] - o.fcstHours[h]).filter((x) => !Number.isNaN(x));
              return r.length ? round3(mean(r)) : 0;
            }),
          ]),
        ),
      },
      peakUplift: { pmf: upliftPmf, n: uplift.length, note: "CLI max minus max METAR (routine+special) over the LST day, clipped at 0; add one draw to the simulated high" },
      forecastOnly: {
        residualSd: round3(foSd),
        stationBias: Object.fromEntries([...byStation].map(([id, ds]) => [id, round3(mean(ds.map(resid)))])),
        note: "stationBias = mean(CLI high - max hourly GFS forecast) over the period",
      },
    },
    notes: [
      `Truth: NWS CLI daily max via IEM json/cli.py. Obs: IEM ASOS METARs (routine+special). Forecast: Open-Meteo historical-forecast GFS (gfs_seamless), hourly.`,
      `Climate day = local standard time midnight to midnight. As-of hours are LST.`,
      `Bins: 5 interior 2°F bins centered on the forecast-only median plus two open tails (7 outcomes).`,
      `Caveat: Open-Meteo historical forecasts are stitched from the first hours of successive model runs, so they behave like short-lead forecasts; a real day-ahead forecast would be worse, which flatters the forecast-only baseline.`,
      `Caveat: nowcast noise params were picked by a 18-point grid search on this same sample (in-sample), and the peak-uplift distribution uses all station-days. Forecast-only station bias and nowcast hourly bias are leave-one-day-out; its residual sd is in-sample.`,
      `Peak uplift: ${negUplift} of ${upliftRaw.length} station-days had CLI max below the max METAR (clipped to 0).`,
      `${skipped} station-days skipped for missing data.`,
      ...notes.filter((n) => !n.startsWith("Skipped")),
    ].join(" "),
  };

  const file = path.join(process.cwd(), "public", "backtest.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(`\nHighwater backtest ${START}..${END}: ${days.length} station-days, ${stations.length} stations`);
  console.log(`noise: base=${best.base} perHour=${best.perHour} cap=${best.cap} iid=${best.iid} decay=${best.decay}; forecast-only sd=${foSd.toFixed(2)}`);
  console.log(`peak uplift: mean=${peakUplift.mean} p50=${peakUplift.p50} p90=${peakUplift.p90}\n`);
  console.log("asOf   n   | Brier now / fcst | LogLoss now / fcst | Acc now / fcst");
  for (const r of byAsOfHour)
    console.log(
      `${String(r.hour).padStart(2)}:00 ${String(r.n).padStart(4)} | ${r.nowcast.brier.toFixed(3)} / ${r.forecastOnly.brier.toFixed(3)}    | ` +
        `${r.nowcast.logLoss.toFixed(3)} / ${r.forecastOnly.logLoss.toFixed(3)}      | ${r.nowcast.acc.toFixed(3)} / ${r.forecastOnly.acc.toFixed(3)}`,
    );
  console.log("\ncalibration (nowcast bin probs): bucket predicted observed n");
  for (const c of calibration) console.log(`  ${c.bucket.toFixed(2)}  ${c.predicted ?? "-"}  ${c.observed ?? "-"}  ${c.n}`);
  console.log(`\nwrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
