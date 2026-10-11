import { cached } from "./cache";

const GEMINI = "https://api.gemini.com/v1/prediction-markets";

export type Bin = { lo: number | null; hi: number | null }; // inclusive whole °F

export type Contract = {
  symbol: string;
  label: string;
  bin: Bin;
  bestBid: number | null;
  bestAsk: number | null;
  last: number | null;
};

export type WeatherEvent = {
  ticker: string;
  title: string;
  city: string; // Gemini city code, e.g. NYC
  date: { y: number; m: number; d: number };
  expiry: string;
  contracts: Contract[];
};

// LO75 -> (-inf, 75], 76TO77 -> [76, 77], HI86 -> [86, inf)
export function parseBin(t: string): Bin | null {
  let m = t.match(/^LO(\d+)$/);
  if (m) return { lo: null, hi: Number(m[1]) };
  m = t.match(/^HI(\d+)$/);
  if (m) return { lo: Number(m[1]), hi: null };
  m = t.match(/^(\d+)TO(\d+)$/);
  if (m) return { lo: Number(m[1]), hi: Number(m[2]) };
  return null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function parseTitleDate(title: string) {
  const m = title.match(/on (\w+) (\d{1,2}), (\d{4})/);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  return mo ? { y: Number(m[3]), m: mo, d: Number(m[2]) } : null;
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

type RawContract = {
  ticker: string;
  label: string;
  instrumentSymbol: string;
  expiryDate?: string;
  prices?: { bestBid?: string; bestAsk?: string; lastTradePrice?: string };
};
type RawEvent = { ticker: string; title: string; status: string; contracts: RawContract[] };

export function weatherEvents(): Promise<WeatherEvent[]> {
  return cached("gemini:weather", 60_000, async () => {
    const r = await fetch(`${GEMINI}/events?category=weather&limit=500`, { cache: "no-store" });
    if (!r.ok) throw new Error(`gemini events: HTTP ${r.status}`);
    const { data } = (await r.json()) as { data: RawEvent[] };
    const out: WeatherEvent[] = [];
    for (const e of data) {
      const [kind, city] = e.ticker.split("-");
      const date = parseTitleDate(e.title);
      if (kind !== "WXHIGH" || !date || e.status !== "active") continue;
      const contracts: Contract[] = [];
      for (const c of e.contracts) {
        const bin = parseBin(c.ticker);
        if (!bin) continue;
        contracts.push({
          symbol: c.instrumentSymbol,
          label: c.label,
          bin,
          bestBid: num(c.prices?.bestBid),
          bestAsk: num(c.prices?.bestAsk),
          last: num(c.prices?.lastTradePrice),
        });
      }
      contracts.sort((a, b) => (a.bin.lo ?? -999) - (b.bin.lo ?? -999));
      out.push({ ticker: e.ticker, title: e.title, city, date, expiry: e.contracts[0]?.expiryDate ?? "", contracts });
    }
    return out;
  });
}
