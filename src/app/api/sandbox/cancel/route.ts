import { cancelOrder, getActiveOrders } from "@/lib/gemini-trade";

export async function POST() {
  const list = await getActiveOrders();
  const out = [];
  for (const o of list) {
    if (o.orderId == null) continue;
    try {
      await cancelOrder(o.orderId);
      out.push({ orderId: o.orderId, ok: true });
    } catch (e) {
      out.push({ orderId: o.orderId, ok: false, error: String(e) });
    }
  }
  return Response.json({ cancelled: out });
}
