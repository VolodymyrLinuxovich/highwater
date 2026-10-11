// Gemini weather city code -> NWS climate station (the site whose Daily
// Climatological Report settles the market). Most codes are the airport
// identifier; the exceptions are mapped explicitly.
const OVERRIDES: Record<string, string> = {
  NYC: "KNYC", // Central Park
  CHI: "KMDW", // Chicago Midway (per Gemini ticker spec)
  LA: "KLAX",
  ANC: "PANC",
};

export function stationFor(code: string): string {
  return OVERRIDES[code] ?? `K${code}`;
}

export type StationMeta = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  timeZone: string;
};

const NWS = "https://api.weather.gov";
export const NWS_HEADERS = {
  "User-Agent": "highwater-hackathon/0.1",
  Accept: "application/geo+json",
};

const metaCache = new Map<string, Promise<StationMeta>>();

export function stationMeta(id: string): Promise<StationMeta> {
  let p = metaCache.get(id);
  if (!p) {
    p = fetch(`${NWS}/stations/${id}`, { headers: NWS_HEADERS, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`station ${id}: HTTP ${r.status}`);
        const j = await r.json();
        const [lon, lat] = j.geometry.coordinates;
        return { id, name: j.properties.name, lat, lon, timeZone: j.properties.timeZone };
      })
      .catch((e) => {
        metaCache.delete(id);
        throw e;
      });
    metaCache.set(id, p);
  }
  return p;
}

// Offset (minutes east of UTC) of a zone's *standard* time. NWS climate days
// run midnight to midnight local standard time, even during DST.
export function standardOffsetMinutes(timeZone: string): number {
  const jan = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 15, 12));
  const jul = new Date(Date.UTC(new Date().getUTCFullYear(), 6, 15, 12));
  return Math.min(offsetAt(timeZone, jan), offsetAt(timeZone, jul));
}

export function offsetAt(timeZone: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")!.value; // "GMT-05:00" or "GMT"
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -mins : mins;
}

// UTC bounds of the climate day for a calendar date at a station.
export function climateDay(timeZone: string, y: number, mo: number, d: number) {
  const off = standardOffsetMinutes(timeZone);
  const start = Date.UTC(y, mo - 1, d) - off * 60_000;
  return { start, end: start + 24 * 3_600_000 };
}
