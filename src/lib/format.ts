export const pct = (p: number) => `${Math.round(p * 100)}%`;

export function shortLabel(l: string) {
  return l
    .replace("°F or below", "° or less")
    .replace("°F or above", "°+")
    .replace(/°F to (\d+)°F/, "–$1°")
    .replace(/°F/g, "°");
}

// 50°F cool blue -> 95°F hot orange-red
export function tempColor(f: number | null) {
  if (f == null) return "#7d8b99";
  const t = Math.min(1, Math.max(0, (f - 50) / 45));
  const a = [76, 194, 255];
  const b = [255, 93, 61];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
