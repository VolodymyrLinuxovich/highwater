import type { Bin, Contract } from "./markets";
import type { Ensemble } from "./forecast";
import type { Obs } from "./obs";
import { PARAMS } from "./params";

// Seeded RNG so refreshes don't jitter the displayed probabilities.
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());
  return { next, normal };
}

const sd = (hoursAhead: number) =>
  Math.min(PARAMS.noiseCap, PARAMS.noiseBase + PARAMS.noiseSlope * Math.max(0, hoursAhead));

function sampleUplift(u: number) {
  let acc = 0;
  for (let k = 0; k < PARAMS.peakUplift.length; k++) {
    acc += PARAMS.peakUplift[k];
    if (u < acc) return k;
  }
  return PARAMS.peakUplift.length - 1;
}

function ensembleMeanAt(ens: Ensemble, t: number): number | null {
  const i = ens.times.findIndex((x) => x >= t);
  if (i <= 0) return null;
  const w = (t - ens.times[i - 1]) / (ens.times[i] - ens.times[i - 1]);
  let s = 0;
  let n = 0;
  for (const m of ens.members) {
    const v = m[i - 1] * (1 - w) + m[i] * w;
    if (Number.isFinite(v)) {
      s += v;
      n++;
    }
  }
  return n ? s / n : null;
}

// Today's forecast miss: recent obs minus ensemble mean, recency-weighted and shrunk toward 0.
export function forecastBias(ens: Ensemble, obs: Obs[], now: number) {
  let num = 0;
  let den = 0;
  for (const o of obs) {
    if (o.t > now || now - o.t > 12 * 3_600_000) continue;
    const mean = ensembleMeanAt(ens, o.t);
    if (mean == null) continue;
    const w = Math.pow(0.5, (now - o.t) / 3_600_000 / PARAMS.biasHalfLifeHours);
    num += w * (o.f - mean);
    den += w;
  }
  return den ? num / (den + 1) : 0;
}

export type Distribution = Map<number, number>; // whole °F -> probability

export type Nowcast = {
  observedMax: number | null;
  floor: number | null; // official high cannot finish below this
  bias: number;
  hoursLeft: number;
  nowcast: Distribution;
  forecastOnly: Distribution;
  weight: number; // share of the observation-conditioned model in the blend
  median: number;
  fan: { t: number; p10: number; p50: number; p90: number }[];
};

export function nowcast(opts: {
  seed: string;
  ens: Ensemble;
  obs: Obs[];
  observedMax: number | null;
  start: number;
  end: number;
  now: number;
  samples?: number;
}): Nowcast {
  const { ens, obs, observedMax, start, end, now } = opts;
  const N = opts.samples ?? 4000;
  const r = rng(opts.seed);
  const bias = forecastBias(ens, obs, now);
  const dayIdx = ens.times.map((t, i) => [t, i] as const).filter(([t]) => t >= start && t <= end);
  const future = dayIdx.filter(([t]) => t > now);
  const hoursLeft = Math.max(0, (end - Math.max(now, start)) / 3_600_000);
  const members = ens.members;
  const perMember = Math.max(1, Math.ceil(N / members.length));

  const now_: number[] = [];
  const fc: number[] = [];
  for (const m of members) {
    // Hottest remaining hour for this member, and how far ahead it is.
    let futMax = -Infinity;
    let futAt = now;
    for (const [t, i] of future) {
      const v = m[i] + bias;
      if (Number.isFinite(v) && v > futMax) {
        futMax = v;
        futAt = t;
      }
    }
    let dayMax = -Infinity;
    let dayAt = now;
    for (const [t, i] of dayIdx) {
      if (Number.isFinite(m[i]) && m[i] > dayMax) {
        dayMax = m[i];
        dayAt = t;
      }
    }
    const futSd = sd((futAt - now) / 3_600_000);
    const daySd = sd((dayAt - now) / 3_600_000);
    for (let k = 0; k < perMember; k++) {
      const f = Number.isFinite(futMax) ? futMax + futSd * r.normal() : -Infinity;
      const o = observedMax != null ? observedMax + sampleUplift(r.next()) : -Infinity;
      const hi = Math.max(o, f);
      if (Number.isFinite(hi)) now_.push(Math.round(hi));
      if (Number.isFinite(dayMax)) fc.push(Math.round(dayMax + daySd * r.normal()));
    }
  }

  const fan = future.slice(0, 36).map(([t, i]) => {
    const vals = members.map((m) => m[i] + bias).filter(Number.isFinite).sort((a, b) => a - b);
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    return { t, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
  });

  // Early in the climate day lean on the forecast-only distribution.
  const hourOfDay = (now - start) / 3_600_000;
  const w = Math.min(1, Math.max(0, (hourOfDay - PARAMS.blendStartHour) / (PARAMS.blendEndHour - PARAMS.blendStartHour)));
  const fcDist = toDist(fc);
  const nowDist = blend(toDist(now_), fcDist, w);
  return {
    observedMax,
    floor: observedMax != null ? Math.floor(observedMax) : null, // floor, not round: one ANC day had CLI 42 with a 42.8°F METAR max
    bias,
    hoursLeft,
    nowcast: nowDist,
    forecastOnly: fcDist,
    weight: w,
    median: quantile(nowDist, 0.5),
    fan,
  };
}

function toDist(xs: number[]): Distribution {
  const d: Distribution = new Map();
  for (const x of xs) d.set(x, (d.get(x) ?? 0) + 1);
  for (const [k, v] of d) d.set(k, v / xs.length);
  return new Map([...d.entries()].sort((a, b) => a[0] - b[0]));
}

function blend(a: Distribution, b: Distribution, w: number): Distribution {
  if (w >= 1) return a;
  const d: Distribution = new Map();
  for (const [k, v] of a) d.set(k, w * v);
  for (const [k, v] of b) d.set(k, (d.get(k) ?? 0) + (1 - w) * v);
  return new Map([...d.entries()].sort((x, y) => x[0] - y[0]));
}

export function quantile(d: Distribution, p: number) {
  let acc = 0;
  for (const [k, v] of d) {
    acc += v;
    if (acc >= p) return k;
  }
  return [...d.keys()].pop() ?? NaN;
}

export function binProb(d: Distribution, b: Bin) {
  let p = 0;
  for (const [k, v] of d) if ((b.lo == null || k >= b.lo) && (b.hi == null || k <= b.hi)) p += v;
  return p;
}

export type Quote = {
  symbol: string;
  label: string;
  bin: Bin;
  fair: number;
  forecastOnly: number;
  bid: number | null;
  ask: number | null;
  market: { bid: number | null; ask: number | null; last: number | null };
  status: "dead" | "locked" | "live";
  edge: { side: "buy" | "sell"; price: number; size: number } | null;
};

const MIN_EDGE = 0.05;

// Two-sided quotes around fair value; spread widens with uncertainty.
export function quote(c: Contract, n: Nowcast): Quote {
  const fair = binProb(n.nowcast, c.bin);
  const dead = n.floor != null && c.bin.hi != null && c.bin.hi < n.floor;
  const half = 0.015 + 0.08 * Math.sqrt(fair * (1 - fair));
  const bid = fair - half >= 0.01 ? Math.floor((fair - half) * 100) / 100 : null;
  const ask = fair + half <= 0.99 ? Math.ceil((fair + half) * 100) / 100 : null;
  let edge: Quote["edge"] = null;
  if (c.bestAsk != null && fair - c.bestAsk >= MIN_EDGE) edge = { side: "buy", price: c.bestAsk, size: fair - c.bestAsk };
  else if (c.bestBid != null && c.bestBid - fair >= MIN_EDGE) edge = { side: "sell", price: c.bestBid, size: c.bestBid - fair };
  return {
    symbol: c.symbol,
    label: c.label,
    bin: c.bin,
    fair,
    forecastOnly: binProb(n.forecastOnly, c.bin),
    bid: dead ? null : bid,
    ask: dead ? 0.01 : ask,
    market: { bid: c.bestBid, ask: c.bestAsk, last: c.last },
    status: dead ? "dead" : fair >= 0.97 ? "locked" : "live",
    edge,
  };
}
