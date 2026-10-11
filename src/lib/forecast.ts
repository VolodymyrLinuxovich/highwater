import { cached } from "./cache";

export type Ensemble = {
  times: number[]; // ms UTC, hourly
  members: number[][]; // [member][hour] °F
};

const MODELS = "gfs_seamless,ecmwf_ifs025";

// GFS (31) + ECMWF (51) ensemble members for many points in one request.
export function ensembles(points: { lat: number; lon: number }[]): Promise<Ensemble[]> {
  const lat = points.map((p) => p.lat.toFixed(3)).join(",");
  const lon = points.map((p) => p.lon.toFixed(3)).join(",");
  return cached(`om:${lat}:${lon}`, 20 * 60_000, async () => {
    const url =
      `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m&models=${MODELS}&temperature_unit=fahrenheit&past_days=1&forecast_days=3&timezone=GMT`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`open-meteo: HTTP ${r.status} ${await r.text()}`);
    const j = await r.json();
    const list = Array.isArray(j) ? j : [j];
    return list.map((loc: { hourly: Record<string, (number | null)[]> & { time: string[] } }) => {
      const times = loc.hourly.time.map((t: string) => Date.parse(`${t}:00Z`));
      const members: number[][] = [];
      for (const [k, v] of Object.entries(loc.hourly)) {
        if (k === "time" || !k.startsWith("temperature_2m")) continue;
        const series = v as (number | null)[];
        if (series.filter((x) => x != null).length < times.length * 0.5) continue;
        members.push(series.map((x) => (x == null ? NaN : x)));
      }
      return { times, members };
    });
  });
}
