import { del, list, put } from "@vercel/blob";
import { buildBoard } from "./board";

// Paper market making on Gemini's real (production) daily-high weather markets.
// Every tick, Highwater's two-sided quote on each contract rests against the
// live Gemini book; a quote fills only when Gemini's best ask/bid crosses it.
// Nothing is sent to Gemini. State is one JSON per day in Vercel Blob (or
// memory when no Blob token is configured).

const TICK_MS = 60_000;
const MAX_POSITION = 3; // contracts per symbol, either direction

export type Fill = {
  t: number;
  symbol: string;
  city: string;
  label: string;
  side: "buy" | "sell";
  price: number;
  fair: number;
  quote: number;
};

export type PaperState = {
  date: string;
  startedAt: number;
  updatedAt: number;
  ticks: number;
  resting: { bids: number; asks: number; contracts: number; marketQuoted: number };
  fills: Fill[];
  positions: Record<string, { city: string; label: string; qty: number; cash: number; fair: number }>;
};

export type PaperBook = PaperState & {
  pnl: number; // cash + qty * fair, summed
  edgeAtFill: number; // sum of (fair - price) on buys and (price - fair) on sells
  exposure: number;
  storage: "blob" | "memory";
};

const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const mem = ((globalThis as { __weatherPaper?: Map<string, PaperState> }).__weatherPaper ??= new Map());
const prefix = (date: string) => `paper-book/${date}/`;

async function load(date: string): Promise<PaperState | null> {
  if (!hasBlob()) return mem.get(date) ?? null;
  const { blobs } = await list({ prefix: prefix(date) });
  const latest = blobs.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))[0];
  if (!latest) return null;
  // Each save is a new pathname, so the CDN copy is never stale.
  const r = await fetch(latest.url, { cache: "no-store" });
  return r.ok ? ((await r.json()) as PaperState) : null;
}

async function save(s: PaperState) {
  if (!hasBlob()) return void mem.set(s.date, s);
  await put(`${prefix(s.date)}state-${s.updatedAt}.json`, JSON.stringify(s), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  const { blobs } = await list({ prefix: prefix(s.date) });
  const old = blobs.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt)).slice(3);
  if (old.length) await del(old.map((b) => b.url)).catch(() => null);
}

async function tick(prev: PaperState | null): Promise<PaperState> {
  const board = await buildBoard();
  const now = Date.now();
  const date = board.cities[0]?.date ?? new Date(now).toISOString().slice(0, 10);
  const s: PaperState =
    prev && prev.date === date
      ? structuredClone(prev)
      : { date, startedAt: now, updatedAt: now, ticks: 0, resting: { bids: 0, asks: 0, contracts: 0, marketQuoted: 0 }, fills: [], positions: {} };

  const resting = { bids: 0, asks: 0, contracts: 0, marketQuoted: 0 };
  for (const c of board.cities) {
    for (const q of c.quotes) {
      resting.contracts++;
      if (q.bid != null) resting.bids++;
      if (q.ask != null) resting.asks++;
      if (q.market.bid != null || q.market.ask != null) resting.marketQuoted++;
      const pos = (s.positions[q.symbol] ??= { city: c.name, label: q.label, qty: 0, cash: 0, fair: q.fair });
      pos.fair = q.fair;
      // At most one fill per contract per tick, and a small position cap.
      let fill: Fill | null = null;
      if (q.bid != null && q.market.ask != null && q.market.ask <= q.bid && pos.qty < MAX_POSITION)
        fill = { t: now, symbol: q.symbol, city: c.name, label: q.label, side: "buy", price: q.market.ask, fair: q.fair, quote: q.bid };
      else if (q.ask != null && q.market.bid != null && q.market.bid >= q.ask && pos.qty > -MAX_POSITION)
        fill = { t: now, symbol: q.symbol, city: c.name, label: q.label, side: "sell", price: q.market.bid, fair: q.fair, quote: q.ask };
      if (!fill) continue;
      // Gemini doesn't show size, so assume one contract per price level: a resting
      // order that already filled us fills again only after its price changes.
      const last = s.fills.findLast((f) => f.symbol === fill.symbol && f.side === fill.side);
      if (last && last.price === fill.price) continue;
      pos.qty += fill.side === "buy" ? 1 : -1;
      pos.cash += fill.side === "buy" ? -fill.price : fill.price;
      s.fills.push(fill);
    }
  }
  s.resting = resting;
  s.ticks++;
  s.updatedAt = now;
  for (const [k, p] of Object.entries(s.positions)) if (p.qty === 0 && p.cash === 0) delete s.positions[k];
  return s;
}

function summarize(s: PaperState): PaperBook {
  const positions = Object.values(s.positions);
  return {
    ...s,
    pnl: positions.reduce((a, p) => a + p.cash + p.qty * p.fair, 0),
    edgeAtFill: s.fills.reduce((a, f) => a + (f.side === "buy" ? f.fair - f.price : f.price - f.fair), 0),
    exposure: positions.reduce((a, p) => a + Math.abs(p.qty), 0),
    storage: hasBlob() ? "blob" : "memory",
  };
}

let inflight: Promise<PaperState> | null = null;

// Read today's book, ticking first if the last tick is more than a minute old.
export async function paperBook(): Promise<PaperBook> {
  const prev = await load(new Date().toISOString().slice(0, 10)).catch(() => null);
  const latest = prev ?? (await findRecent());
  if (latest && Date.now() - latest.updatedAt < TICK_MS) return summarize(latest);
  inflight ??= tick(latest)
    .then(async (s) => {
      await save(s);
      return s;
    })
    .finally(() => {
      inflight = null;
    });
  return summarize(await inflight);
}

// The board date is the market's local day, which can trail UTC by a day.
async function findRecent() {
  const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return load(y).catch(() => null);
}
