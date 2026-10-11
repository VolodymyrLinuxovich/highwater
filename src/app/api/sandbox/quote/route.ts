import { cryptoFairs, type ContractFair } from "@/lib/crypto-engine";
import { acceptTerms, cancelOrder, getActiveOrders, placeOrder, termsStatus, tradeMode, tradingEnabled, type OrderIn } from "@/lib/gemini-trade";

const HALF_SPREAD = 0.03;
const MIN_MINUTES = 2;

// Market-make the contracts where fair value sits furthest from the sandbox
// book: bid Yes at fair - 0.03 and offer at fair + 0.03, the offer placed as a
// No bid at 1 - (fair + 0.03) so no Yes inventory is needed.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { count?: number; quantity?: number; dryRun?: boolean; acceptTerms?: boolean };
  const count = Math.min(5, Math.max(3, body.count ?? 4));
  const quantity = body.quantity ?? 1;

  let fairs: ContractFair[];
  try {
    fairs = await cryptoFairs();
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 503 });
  }
  const live = fairs.filter((f) => f.minutesLeft >= MIN_MINUTES);
  const booked = live
    .filter((f) => f.bestBid != null || f.bestAsk != null)
    .map((f) => {
      const market = f.bestBid != null && f.bestAsk != null ? (f.bestBid + f.bestAsk) / 2 : (f.bestBid ?? f.bestAsk)!;
      return { ...f, market: market as number | null, gap: Math.abs(f.fair - market) as number | null };
    })
    .sort((a, b) => b.gap! - a.gap!);
  // Sandbox books are often empty; then make the market on the most uncertain contracts.
  const empty = live
    .filter((f) => f.bestBid == null && f.bestAsk == null && f.fair > 0.1 && f.fair < 0.9)
    .sort((a, b) => Math.abs(a.fair - 0.5) - Math.abs(b.fair - 0.5))
    .map((f) => ({ ...f, market: null, gap: null }));
  const ranked = [...booked, ...empty].slice(0, count);

  const tick = (x: number, f: ContractFair) => {
    const p = Math.round(x / f.priceIncrement) * f.priceIncrement;
    return Math.min(1 - f.priceMinimum, Math.max(f.priceMinimum, Number(p.toFixed(4))));
  };
  const plan = ranked.flatMap((f) => {
    const bid = tick(f.fair - HALF_SPREAD, f);
    const ask = tick(f.fair + HALF_SPREAD, f);
    const legs: (OrderIn & { leg: string })[] = [
      { leg: `bid yes ${bid.toFixed(2)}`, symbol: f.instrumentSymbol, side: "buy", outcome: "yes", price: bid, quantity },
      { leg: `offer yes ${ask.toFixed(2)}`, symbol: f.instrumentSymbol, side: "buy", outcome: "no", price: tick(1 - ask, f), quantity },
    ];
    return legs.map((l) => ({ ...l, event: f.event, label: f.label, fair: f.fair, bestBid: f.bestBid, bestAsk: f.bestAsk, gap: f.gap }));
  });
  if (body.dryRun) return Response.json({ planned: plan, considered: fairs.length });

  const terms = tradingEnabled() ? await termsStatus().catch((e) => ({ error: String(e) })) : { skipped: "no API key" };
  if ("hasAcceptedLatest" in terms && terms.hasAcceptedLatest === false) {
    if (!body.acceptTerms)
      return Response.json({ error: "Prediction Markets terms not accepted on this account. Re-send with acceptTerms: true to accept them.", terms }, { status: 409 });
    await acceptTerms();
  }

  // Requote: pull our resting orders on these contracts before placing new ones.
  const symbols = new Set(plan.map((o) => o.symbol));
  const stale = (await getActiveOrders().catch(() => [])).filter((o) => o.orderId != null && symbols.has(o.symbol ?? ""));
  await Promise.all(stale.map((o) => cancelOrder(o.orderId!).catch(() => null)));

  const placed: (typeof plan[number] & { ok: boolean; orderId?: number; status?: string; paper?: boolean; geminiRejection?: string; error?: string })[] = [];
  for (const o of plan) {
    try {
      const r = await placeOrder(o);
      placed.push({ ...o, ok: true, orderId: r.orderId, status: r.status, paper: r.paper ?? false, geminiRejection: r.geminiRejection });
    } catch (e) {
      placed.push({ ...o, ok: false, error: String(e) });
    }
  }
  return Response.json({ mode: tradeMode(), orderIds: placed.filter((p) => p.ok).map((p) => p.orderId), placed, terms });
}
