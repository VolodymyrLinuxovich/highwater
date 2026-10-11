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
import {
  avgScore, buildDay, dateList, forecastOnly, hourlyObs, loadStation, mean, nowcast, quantile, round3, score,
  type Day, type NoiseParams, type Score, type Station,
} from "./lib-replay";

const STATIONS = ["KNYC", "KMDW", "KMIA", "KLAX", "KBOS", "KATL", "KDEN", "KDFW", "KPHX", "KSEA", "KMSP", "KPHL"];
const START = "2026-09-10";
const END = "2026-10-10";
const AS_OF_HOURS = [9, 12, 15, 18];

const notes: string[] = [];

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
// ---------- main ----------
async function main() {
  const stations: Station[] = [];
  for (const id of STATIONS) {
    try {
      stations.push(await loadStation(id, START, END));
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
