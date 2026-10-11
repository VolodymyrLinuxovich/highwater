export const pct = (p: number) => `${Math.round(p * 100)}%`;

export function shortLabel(l: string) {
  return l
    .replace("°F or below", "° or less")
    .replace("°F or above", "°+")
    .replace(/°F to (\d+)°F/, "–$1°")
    .replace(/°F/g, "°");
}
