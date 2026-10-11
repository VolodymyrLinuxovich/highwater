import { sandboxCryptoBoard } from "@/lib/crypto";
import { placeOrder, type OrderIn } from "@/lib/gemini-trade";

const MIN_EDGE = 0.04;
const MAX_ORDERS = 4;

// Take the largest gaps between fair value and the sandbox book: buy Yes when
// the ask is below fair, buy No when the bid is above fair.
export async function POST(req: Request) {
  const { quantity = 1, dryRun = false } = (await req.json().catch(() => ({}))) as { quantity?: number; dryRun?: boolean };
  const { events, staleSince } = await sandboxCryptoBoard();
  if (staleSince) return Response.json({ error: "Gemini sandbox is not responding; not trading on stale prices." }, { status: 503 });
  const candidates: (OrderIn & { fair: number; gap: number; label: string; event: string })[] = [];
  for (const e of events) {
    for (const q of e.quotes) {
      const { bid, ask } = q.market;
      if (ask != null && q.fair - ask >= MIN_EDGE)
        candidates.push({ symbol: q.symbol, side: "buy", outcome: "yes", price: ask, quantity, fair: q.fair, gap: q.fair - ask, label: q.label, event: e.title });
      else if (bid != null && bid - q.fair >= MIN_EDGE)
        candidates.push({ symbol: q.symbol, side: "buy", outcome: "no", price: Math.round((1 - bid) * 100) / 100, quantity, fair: q.fair, gap: bid - q.fair, label: q.label, event: e.title });
    }
  }
  candidates.sort((a, b) => b.gap - a.gap);
  const picked = candidates.slice(0, MAX_ORDERS);
  if (dryRun) return Response.json({ planned: picked });
  const results = [];
  for (const o of picked) {
    try {
      results.push({ ...o, ok: true, order: await placeOrder(o) });
    } catch (e) {
      results.push({ ...o, ok: false, error: String(e) });
    }
  }
  return Response.json({ placed: results, considered: candidates.length });
}
