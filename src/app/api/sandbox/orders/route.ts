import { getActiveOrders } from "@/lib/gemini-trade";

export async function GET(req: Request) {
  try {
    const symbol = new URL(req.url).searchParams.get("symbol") ?? undefined;
    return Response.json({ orders: await getActiveOrders(symbol) });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
