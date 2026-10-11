import { sandboxCryptoBoard } from "@/lib/crypto";
import { getActiveOrders, tradeMode } from "@/lib/gemini-trade";

export async function GET() {
  try {
    const { events, staleSince } = await sandboxCryptoBoard();
    let orders: unknown = null;
    let ordersError: string | null = null;
    try {
      orders = await getActiveOrders();
    } catch (e) {
      ordersError = String(e);
    }
    return Response.json({ generatedAt: Date.now(), tradingEnabled: true, mode: tradeMode(), events, staleSince, orders, ordersError });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
