import { activeOrders, cancelOrder, tradingEnabled, type OrderOut } from "@/lib/gemini-trade";

export async function POST() {
  if (!tradingEnabled()) return Response.json({ error: "trading disabled" }, { status: 400 });
  const res = await activeOrders();
  const list: OrderOut[] = Array.isArray(res) ? res : (res.orders ?? []);
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
