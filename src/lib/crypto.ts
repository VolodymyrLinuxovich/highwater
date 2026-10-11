import { cached } from "./cache";

// Same question as the weather side ("where will it land at expiry?") for the
// crypto price contracts listed in Gemini's sandbox: spot + realized vol ->
// lognormal terminal distribution -> P(price >= strike).

const SANDBOX = "https://api.sandbox.gemini.com/v1/prediction-markets";
const PUBLIC = "https://api.gemini.com";

type RawContract = {
  instrumentSymbol: string;
  label: string;
  strike?: { type: string; value: string };
  expiryDate: string;
  prices?: { bestBid?: string; bestAsk?: string; lastTradePrice?: string };
};
type RawEvent = { ticker: string; title: string; category: string; status: string; contracts: RawContract[] };

export type CryptoQuote = {
  symbol: string;
  label: string;
  strike: number;
  fair: number;
  market: { bid: number | null; ask: number | null; last: number | null };
  edge: number | null; // fair - market mid
};

export type CryptoEvent = {
  ticker: string;
  title: string;
  asset: string;
  spot: number;
  volPerSqrtMin: number;
  minutesLeft: number;
  expiry: string;
  quotes: CryptoQuote[];
};

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

function normCdf(x: number) {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function spot(asset: string) {
  return cached(`spot:${asset}`, 10_000, async () => {
    const r = await fetch(`${PUBLIC}/v1/pubticker/${asset.toLowerCase()}usd`, { cache: "no-store" });
    if (!r.ok) throw new Error(`ticker ${asset}: HTTP ${r.status}`);
    const j = await r.json();
    return (Number(j.bid) + Number(j.ask)) / 2;
  });
}

// Realized volatility of 1-minute log returns over the last 2 hours.
function minuteVol(asset: string) {
  return cached(`vol:${asset}`, 60_000, async () => {
    const r = await fetch(`${PUBLIC}/v2/candles/${asset.toLowerCase()}usd/1m`, { cache: "no-store" });
    if (!r.ok) throw new Error(`candles ${asset}: HTTP ${r.status}`);
    const rows = ((await r.json()) as number[][]).slice(0, 121).reverse();
    const rets: number[] = [];
    for (let i = 1; i < rows.length; i++) rets.push(Math.log(rows[i][4] / rows[i - 1][4]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    return Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
  });
}

// The sandbox API is flaky (intermittent 503s); fall back to the last good board.
let lastGood: { at: number; events: CryptoEvent[] } | null = null;

export async function sandboxCryptoBoard(): Promise<{ events: CryptoEvent[]; staleSince: number | null }> {
  try {
    const events = await loadBoard();
    lastGood = { at: Date.now(), events };
    return { events, staleSince: null };
  } catch (e) {
    if (lastGood) return { events: lastGood.events, staleSince: lastGood.at };
    throw e;
  }
}

function loadBoard(): Promise<CryptoEvent[]> {
  return cached("sandbox:crypto", 15_000, async () => {
    const r = await fetch(`${SANDBOX}/events?category=crypto&limit=200`, { cache: "no-store" });
    if (!r.ok) throw new Error(`sandbox events: HTTP ${r.status}`);
    const { data } = (await r.json()) as { data: RawEvent[] };
    const now = Date.now();
    const out: CryptoEvent[] = [];
    for (const e of data) {
      const asset = e.ticker.match(/^([A-Z]+?)(15M)?\d{10}$/)?.[1];
      const contracts = e.contracts.filter((c) => c.strike?.type === "above");
      if (!asset || e.status !== "active" || !contracts.length) continue;
      const expiry = Date.parse(contracts[0].expiryDate);
      const minutesLeft = (expiry - now) / 60_000;
      if (minutesLeft <= 0.5) continue;
      let s: number;
      let v: number;
      try {
        [s, v] = await Promise.all([spot(asset), minuteVol(asset)]);
      } catch {
        continue;
      }
      const sig = v * Math.sqrt(minutesLeft);
      const quotes = contracts.map((c) => {
        const k = Number(c.strike!.value);
        const fair = normCdf((Math.log(s / k) - (sig * sig) / 2) / sig);
        const bid = num(c.prices?.bestBid);
        const ask = num(c.prices?.bestAsk);
        const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
        return {
          symbol: c.instrumentSymbol,
          label: c.label,
          strike: k,
          fair,
          market: { bid, ask, last: num(c.prices?.lastTradePrice) },
          edge: mid != null ? fair - mid : null,
        };
      });
      out.push({ ticker: e.ticker, title: e.title, asset, spot: s, volPerSqrtMin: v, minutesLeft, expiry: contracts[0].expiryDate, quotes });
    }
    return out.sort((a, b) => a.minutesLeft - b.minutesLeft);
  });
}
