import { createHmac } from "node:crypto";
import { cryptoFairs } from "./crypto-engine";

// Gemini Prediction Markets trading over REST, per developer.gemini.com
// (specs/openapi/prediction-markets.yaml + authentication/api-key): the JSON
// {request, nonce, ...params} goes base64 in X-GEMINI-PAYLOAD, signed with
// HMAC-SHA384, and the HTTP body is empty.
const BASE = process.env.GEMINI_BASE_URL ?? "https://api.sandbox.gemini.com";

export const tradingEnabled = () => Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_SECRET);

// Without a key (e.g. the public deployment) every order is a paper order.
export const tradeMode = (): "auto" | "live" | "paper" =>
  !tradingEnabled() ? "paper" : ((process.env.GEMINI_TRADE_MODE as "auto" | "live" | "paper" | undefined) ?? "auto");

// Keys are created with either a time-based nonce (epoch seconds, +/-30s,
// Gemini's recommended default) or an incremental one (strictly increasing).
let lastNonce = 0;
function nextNonce() {
  if (process.env.GEMINI_NONCE_MODE === "incremental") {
    lastNonce = Math.max(Date.now(), lastNonce + 1);
    return lastNonce;
  }
  return Math.floor(Date.now() / 1000);
}

async function signed<T>(method: "GET" | "POST", endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  const secret = process.env.GEMINI_API_SECRET;
  if (!key || !secret) throw new Error("GEMINI_API_KEY and GEMINI_API_SECRET are not set");
  const payload = Buffer.from(JSON.stringify({ request: endpoint, nonce: nextNonce(), ...params })).toString("base64");
  const signature = createHmac("sha384", secret).update(payload).digest("hex");
  const r = await fetch(`${BASE}${endpoint}`, {
    method,
    cache: "no-store",
    headers: {
      "Content-Type": "text/plain",
      "Content-Length": "0",
      "X-GEMINI-APIKEY": key,
      "X-GEMINI-PAYLOAD": payload,
      "X-GEMINI-SIGNATURE": signature,
      "Cache-Control": "no-cache",
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Gemini ${method} ${endpoint} ${r.status}: ${text}`);
  return JSON.parse(text) as T;
}

export type OrderIn = {
  symbol: string;
  side: "buy" | "sell";
  outcome: "yes" | "no";
  price: number;
  quantity: number;
  makerOnly?: boolean;
};

export type OrderOut = {
  orderId?: number;
  paper?: boolean;
  geminiRejection?: string;
  status?: string;
  symbol?: string;
  side?: string;
  outcome?: string;
  orderType?: string;
  price?: string;
  quantity?: string;
  filledQuantity?: string;
  remainingQuantity?: string;
  createdAt?: string;
};

export type Position = {
  symbol: string;
  instrumentId?: number;
  totalQuantity: string;
  quantityOnHold?: string;
  avgPrice?: string;
  outcome: "yes" | "no";
  paper?: boolean;
};

// POST /v1/prediction-markets/order
function placeLive(o: OrderIn) {
  return signed<OrderOut>("POST", "/v1/prediction-markets/order", {
    symbol: o.symbol,
    orderType: "limit",
    side: o.side,
    outcome: o.outcome,
    price: o.price.toFixed(2),
    quantity: String(o.quantity),
    timeInForce: "good-til-cancel",
    ...(o.makerOnly ? { makerOrCancel: true } : {}),
  });
}

// POST /v1/prediction-markets/order/cancel
export function cancelOrder(orderId: number) {
  if (paper.orders.has(orderId)) {
    paper.orders.delete(orderId);
    return Promise.resolve({ result: "ok", message: `Paper order ${orderId} cancelled` });
  }
  return signed<{ result?: string; message?: string }>("POST", "/v1/prediction-markets/order/cancel", { orderId });
}

// POST /v1/prediction-markets/orders/active (max 100 per page)
export async function getActiveOrders(symbol?: string): Promise<OrderOut[]> {
  const res = !tradingEnabled() ? [] : await signed<{ orders?: OrderOut[] } | OrderOut[]>("POST", "/v1/prediction-markets/orders/active", {
    limit: 100,
    ...(symbol ? { symbol } : {}),
  });
  const live = Array.isArray(res) ? res : (res.orders ?? []);
  await sweepPaper();
  return [...live, ...[...paper.orders.values()].filter((o) => !symbol || o.symbol === symbol)];
}

// POST /v1/prediction-markets/positions
export async function getPositions(): Promise<Position[]> {
  const res = !tradingEnabled() ? [] : await signed<{ positions?: Position[] } | Position[]>("POST", "/v1/prediction-markets/positions");
  const live = Array.isArray(res) ? res : (res.positions ?? []);
  await sweepPaper();
  const paperPositions = [...paper.positions.values()].map((p) => ({
    symbol: p.symbol,
    outcome: p.outcome,
    totalQuantity: String(p.quantity),
    avgPrice: (p.cost / p.quantity).toFixed(4),
    paper: true,
  }));
  return [...live, ...paperPositions];
}

// Paper fallback. The sandbox currently authenticates and serves books but
// rejects every prediction order (order/batch: 503 "Prediction markets are not
// currently available"; order: 422 UnknownInstrument). In GEMINI_TRADE_MODE
// "auto" (default) each order still goes to Gemini first; only that rejection
// turns it into a paper order that fills against the live sandbox book.
// "live" never falls back, "paper" never calls Gemini (also the mode when no key
// is set). In memory, per process.
type PaperOrder = OrderOut & { orderId: number; paper: true; symbol: string; side: "buy"; outcome: "yes" | "no"; limit: number; qty: number };
const paper = ((globalThis as { __paperBook?: unknown }).__paperBook ??= {
  nextId: 9_000_000_001,
  orders: new Map<number, PaperOrder>(),
  positions: new Map<string, { symbol: string; outcome: "yes" | "no"; quantity: number; cost: number }>(),
}) as {
  nextId: number;
  orders: Map<number, PaperOrder>;
  positions: Map<string, { symbol: string; outcome: "yes" | "no"; quantity: number; cost: number }>;
};

const sandboxDown = (e: unknown) => /UnknownInstrument|not currently available/.test(String(e));

export async function placeOrder(o: OrderIn): Promise<OrderOut> {
  const mode = tradeMode();
  let rejection = tradingEnabled() ? "GEMINI_TRADE_MODE=paper" : "No API key on this deployment";
  if (mode !== "paper") {
    try {
      return await placeLive(o);
    } catch (e) {
      if (mode === "live" || !sandboxDown(e) || o.side !== "buy") throw e;
      rejection = String(e);
    }
  }
  const order: PaperOrder = {
    orderId: paper.nextId++,
    paper: true,
    geminiRejection: rejection,
    status: "open",
    symbol: o.symbol,
    side: "buy",
    outcome: o.outcome,
    orderType: "limit",
    price: o.price.toFixed(2),
    quantity: String(o.quantity),
    filledQuantity: "0",
    remainingQuantity: String(o.quantity),
    createdAt: new Date().toISOString(),
    limit: o.price,
    qty: o.quantity,
  };
  paper.orders.set(order.orderId, order);
  await sweepPaper();
  return paper.orders.get(order.orderId) ?? { ...order, status: "filled", filledQuantity: String(o.quantity), remainingQuantity: "0" };
}

// A paper buy fills when the sandbox book crosses it: Yes at the best ask,
// No at 1 - best bid (the Yes bid is the No offer).
async function sweepPaper() {
  if (!paper.orders.size) return;
  const book = new Map((await cryptoFairs().catch(() => [])).map((f) => [f.instrumentSymbol, f]));
  for (const o of paper.orders.values()) {
    const f = book.get(o.symbol);
    if (!f) continue;
    const fillAt = o.outcome === "yes" ? f.bestAsk : f.bestBid != null ? 1 - f.bestBid : null;
    if (fillAt == null || fillAt > o.limit + 1e-9) continue;
    const key = `${o.symbol}:${o.outcome}`;
    const pos = paper.positions.get(key) ?? { symbol: o.symbol, outcome: o.outcome, quantity: 0, cost: 0 };
    pos.quantity += o.qty;
    pos.cost += o.qty * fillAt;
    paper.positions.set(key, pos);
    paper.orders.delete(o.orderId);
  }
}

// Orders are rejected until the account group accepts the latest terms.
export function termsStatus() {
  return signed<{ hasAcceptedLatest?: boolean }>("GET", "/v1/prediction-markets/terms/status");
}

export function acceptTerms() {
  return signed<{ success?: boolean }>("POST", "/v1/prediction-markets/terms/accept");
}
