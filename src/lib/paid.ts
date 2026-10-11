import { buildBoard, type CityCard } from "./board";

export const PRICE_FORECAST = 0.005; // AUSD per city
export const PRICE_BOARD = 0.05; // AUSD for all cities

// What a trading agent needs: the distribution, fair values and the book.
export function forecastView(c: CityCard) {
  return {
    ticker: c.ticker,
    city: c.city,
    name: c.name,
    station: c.station,
    date: c.date,
    asOf: new Date().toISOString(),
    observedMax: c.observedMax,
    median: c.median,
    range80: [c.p10, c.p90],
    hoursLeft: c.hoursLeft,
    distribution: c.dist.map((d) => ({ f: d.f, p: Math.round(d.p * 1e4) / 1e4 })),
    contracts: c.quotes.map((q) => ({
      symbol: q.symbol,
      label: q.label,
      fair: Math.round(q.fair * 1e4) / 1e4,
      status: q.status,
      quote: { bid: q.bid, ask: q.ask },
      market: q.market,
      edge: q.edge,
    })),
  };
}

export async function cityForecast(code: string) {
  const board = await buildBoard();
  const c = board.cities.find((x) => x.city.toUpperCase() === code.toUpperCase());
  return c ? forecastView(c) : null;
}
