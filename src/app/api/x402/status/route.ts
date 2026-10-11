import { PRICE_BOARD, PRICE_FORECAST } from "@/lib/paid";
import { AUSD, NETWORK, payTo, recentPayments, x402Enabled } from "@/lib/x402";

export async function GET() {
  let payments: Awaited<ReturnType<typeof recentPayments>> = [];
  let error: string | null = null;
  try {
    payments = await recentPayments();
  } catch (e) {
    error = String(e);
  }
  return Response.json({
    enabled: x402Enabled(),
    network: NETWORK,
    asset: AUSD,
    payTo: payTo(),
    prices: { forecast: PRICE_FORECAST, board: PRICE_BOARD },
    demoAgent: Boolean(process.env.AGENT_KEY),
    revenue: payments.reduce((s, p) => s + p.value, 0),
    payments: payments.slice(0, 20),
    error,
  });
}
