import { cached } from "./cache";

export type Obs = { t: number; f: number; raw: string };
export type SixHourMax = { t: number; f: number }; // max over (t - 6h, t]

const cToF = (c: number) => (c * 9) / 5 + 32;

// Temperature from a METAR: prefer the T-group (tenths °C) over the whole-degree body group.
export function metarTempC(raw: string): number | null {
  const t = raw.match(/\sT([01])(\d{3})[01]\d{3}\b/) ?? raw.match(/\sT([01])(\d{3})\b/);
  if (t) return (t[1] === "1" ? -1 : 1) * (Number(t[2]) / 10);
  const body = raw.split(" RMK")[0].match(/\s(M?\d{2})\/(M?\d{2})?\s/);
  if (body) return Number(body[1].replace("M", "-"));
  return null;
}

// Synoptic 6-hour max group "1snTTT" in the remarks section.
export function metarSixHourMaxC(raw: string): number | null {
  const rmk = raw.split(" RMK ")[1];
  if (!rmk) return null;
  const m = ` ${rmk} `.match(/\s1([01])(\d{3})\s/);
  return m ? (m[1] === "1" ? -1 : 1) * (Number(m[2]) / 10) : null;
}

type AwcMetar = { icaoId: string; obsTime: number; rawOb: string };

// aviationweather.gov returns at most 400 rows per request, and a station
// files ~30-45 reports in 36 hours. Query in groups small enough to stay
// under the cap so every station gets its full climate day.
const AWC_GROUP = 6;

async function fetchMetars(ids: string[]): Promise<AwcMetar[]> {
  const url = `https://aviationweather.gov/api/data/metar?ids=${ids.join(",")}&format=json&hours=36`;
  const r = await fetch(url, { cache: "no-store", headers: { "User-Agent": "highwater-hackathon/0.1" } });
  if (!r.ok) throw new Error(`awc metar: HTTP ${r.status}`);
  const rows = (await r.json()) as AwcMetar[];
  if (rows.length >= 400) console.warn(`awc metar: ${ids.length} stations hit the 400-row cap`);
  return rows;
}

export function recentMetars(ids: string[]): Promise<Map<string, { obs: Obs[]; sixMax: SixHourMax[] }>> {
  const key = `awc:${[...ids].sort().join(",")}`;
  return cached(key, 4 * 60_000, async () => {
    const groups: string[][] = [];
    for (let i = 0; i < ids.length; i += AWC_GROUP) groups.push(ids.slice(i, i + AWC_GROUP));
    const rows = (await Promise.all(groups.map(fetchMetars))).flat();
    const out = new Map<string, { obs: Obs[]; sixMax: SixHourMax[] }>();
    for (const id of ids) out.set(id, { obs: [], sixMax: [] });
    for (const m of rows) {
      const slot = out.get(m.icaoId);
      if (!slot) continue;
      const t = m.obsTime * 1000;
      const c = metarTempC(m.rawOb);
      if (c != null) slot.obs.push({ t, f: cToF(c), raw: m.rawOb });
      const mx = metarSixHourMaxC(m.rawOb);
      if (mx != null) slot.sixMax.push({ t, f: cToF(mx) });
    }
    for (const s of out.values()) s.obs.sort((a, b) => a.t - b.t);
    return out;
  });
}

// Highest temperature already on record inside the climate-day window.
export function observedMax(obs: Obs[], sixMax: SixHourMax[], start: number, end: number, now: number) {
  let max = -Infinity;
  let at: number | null = null;
  for (const o of obs) {
    if (o.t >= start && o.t <= Math.min(end, now) && o.f > max) {
      max = o.f;
      at = o.t;
    }
  }
  // A 6-hour max only counts if its whole window sits inside the climate day.
  const slack = 10 * 60_000;
  for (const s of sixMax) {
    if (s.t - 6 * 3_600_000 >= start - slack && s.t <= end + slack && s.t <= now && s.f > max) {
      max = s.f;
      at = s.t;
    }
  }
  return Number.isFinite(max) ? { f: max, at } : null;
}
