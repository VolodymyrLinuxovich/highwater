import { sandboxCryptoBoard } from "@/lib/crypto";
import { activeOrders, tradingEnabled } from "@/lib/gemini-trade";

export async function GET() {
  try {
    const { events, staleSince } = await sandboxCryptoBoard();
    let orders: unknown = null;
    let ordersError: string | null = null;
    if (tradingEnabled()) {
      try {
        orders = await activeOrders();
      } catch (e) {
        ordersError = String(e);
      }
    }
    return Response.json({ generatedAt: Date.now(), tradingEnabled: tradingEnabled(), events, staleSince, orders, ordersError });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
