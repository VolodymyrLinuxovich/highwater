import { cached } from "./cache";

// Fair value for every live sandbox crypto contract: spot and realized vol
// from Gemini public market data, lognormal terminal price, P(price >= strike).
// Covers both "above" strike ladders and "reference" Up/Down contracts (strike
// = price at window start). Contracts are untradeable (UnknownInstrument)
// until their effectiveDate, so those are skipped.

const SANDBOX = process.env.GEMINI_BASE_URL ?? "https://api.sandbox.gemini.com";
const PUBLIC = "https://api.gemini.com";

type RawContract = {
  instrumentSymbol: string;
  label: string;
  status: string;
  effectiveDate?: string;
  marketState?: string;
  strike?: { type: string; value?: string; availableAt?: string };
  expiryDate: string;
  priceIncrement?: string;
  priceMinimum?: string;
  prices?: { bestBid?: string; bestAsk?: string };
};
type RawEvent = { ticker: string; title: string; status: string; contracts: RawContract[] };

export type ContractFair = {
  instrumentSymbol: string;
  label: string;
  event: string;
  fair: number;
  bestBid: number | null;
  bestAsk: number | null;
  priceIncrement: number;
  priceMinimum: number;
  minutesLeft: number;
};

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

function normCdf(x: number) {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function spot(asset: string) {
  return cached(`engine:spot:${asset}`, 10_000, async () => {
    const r = await fetch(`${PUBLIC}/v1/pubticker/${asset.toLowerCase()}usd`, { cache: "no-store" });
    if (!r.ok) throw new Error(`ticker ${asset}: HTTP ${r.status}`);
    const j = await r.json();
    return (Number(j.bid) + Number(j.ask)) / 2;
  });
}

// Std dev of 1-minute log returns over the last 2 hours (candles come newest first).
function minuteVol(asset: string) {
  return cached(`engine:vol:${asset}`, 60_000, async () => {
    const r = await fetch(`${PUBLIC}/v2/candles/${asset.toLowerCase()}usd/1m`, { cache: "no-store" });
    if (!r.ok) throw new Error(`candles ${asset}: HTTP ${r.status}`);
    const closes = ((await r.json()) as number[][]).slice(0, 121).map((c) => c[4]).reverse();
    const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    return Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
  });
}

// The sandbox intermittently answers 200 {"error":"Service temporarily unavailable"}.
async function sandboxEvents(): Promise<RawEvent[]> {
  return cached("engine:events", 15_000, async () => {
    let last = "";
    for (let i = 0; i < 4; i++) {
      const r = await fetch(`${SANDBOX}/v1/prediction-markets/events?category=crypto&limit=200`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok && Array.isArray(j?.data)) return j.data as RawEvent[];
      last = `HTTP ${r.status} ${JSON.stringify(j)}`;
      await new Promise((res) => setTimeout(res, 400 * (i + 1)));
    }
    throw new Error(`sandbox events: ${last}`);
  });
}

export async function cryptoFairs(): Promise<ContractFair[]> {
  const events = await sandboxEvents();
  const now = Date.now();
  const out: ContractFair[] = [];
  for (const e of events) {
    const asset = e.ticker.match(/^([A-Z]+?)(05M|15M)?\d{10}$/)?.[1];
    if (!asset || e.status !== "active") continue;
    let s: number, v: number;
    try {
      [s, v] = await Promise.all([spot(asset), minuteVol(asset)]);
    } catch {
      continue; // asset not listed on Gemini spot
    }
    for (const c of e.contracts) {
      const minutesLeft = (Date.parse(c.expiryDate) - now) / 60_000;
      if (c.status !== "active" || c.marketState !== "open" || minutesLeft <= 0.5 || !c.strike) continue;
      if (Date.parse(c.effectiveDate ?? "") > now) continue;
      if ((c.strike.type !== "above" && c.strike.type !== "reference") || !c.strike.value) continue;
      const sig = v * Math.sqrt(minutesLeft);
      const fair = normCdf((Math.log(s / Number(c.strike.value)) - (sig * sig) / 2) / sig);
      out.push({
        instrumentSymbol: c.instrumentSymbol,
        label: c.label,
        event: e.title,
        fair,
        bestBid: num(c.prices?.bestBid),
        bestAsk: num(c.prices?.bestAsk),
        priceIncrement: num(c.priceIncrement) ?? 0.01,
        priceMinimum: num(c.priceMinimum) ?? 0.01,
        minutesLeft,
      });
    }
  }
  return out;
}
