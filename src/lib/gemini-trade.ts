import { createHmac } from "node:crypto";

// Gemini Prediction Markets trading over REST, signed the same way as
// Gemini's own SDKs: base64(JSON {request, nonce, ...body}) + HMAC-SHA384.
const BASE = process.env.GEMINI_BASE_URL ?? "https://api.sandbox.gemini.com";

export const tradingEnabled = () => Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_SECRET);

let lastNonce = 0;

async function signedPost<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  const secret = process.env.GEMINI_API_SECRET;
  if (!key || !secret) throw new Error("GEMINI_API_KEY and GEMINI_API_SECRET are not set");
  // Millisecond nonce, strictly increasing within this process.
  lastNonce = Math.max(Date.now(), lastNonce + 1);
  const payload = Buffer.from(JSON.stringify({ request: endpoint, nonce: lastNonce, ...body })).toString("base64");
  const signature = createHmac("sha384", secret).update(payload).digest("hex");
  const r = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-GEMINI-APIKEY": key,
      "X-GEMINI-PAYLOAD": payload,
      "X-GEMINI-SIGNATURE": signature,
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Gemini ${endpoint} ${r.status}: ${text}`);
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
  status?: string;
  symbol?: string;
  side?: string;
  outcome?: string;
  price?: string;
  quantity?: string;
  filledQuantity?: string;
  createdAt?: string;
};

export function placeOrder(o: OrderIn) {
  return signedPost<OrderOut>("/v1/prediction-markets/order", {
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

export function cancelOrder(orderId: number) {
  return signedPost("/v1/prediction-markets/order/cancel", { orderId });
}

export function activeOrders() {
  return signedPost<{ orders?: OrderOut[] } | OrderOut[]>("/v1/prediction-markets/orders/active");
}

export function positions() {
  return signedPost<unknown>("/v1/prediction-markets/positions");
}
